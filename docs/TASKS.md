# Maestro — Build Tracker

*Meridian Resource & Traffic Management Platform*

> Source of truth for build progress. Derived from **Design Draft v15** (`docs/design/design-draft-v15.md`).
> Phasing follows §12 of the design doc: the scheduling surface ships first, but the schema assumes the
> accountability engine from day one.
>
> **Conventions**
> - `[ ]` pending · `[x]` done · `[~]` in progress (edit the checkbox to `[~]` manually)
> - Task IDs (`M1.2`, `V1.4.3`, `P2.1.1`) are stable — reference them in commits (`feat: booking states [M4.2]`).
> - ⚠️ marks tasks gated by an Open Decision (see the OD Gate table at the bottom); resolve the OD before starting.
> - 🔒 marks security-critical work inheriting the "disproportionate testing" flag (§10.2, §10.4, §13).

---

## Phase 0 — Foundations & Project Setup

### 0.1 Repo & tooling
- [x] `0.1.1` Initialize repo: Vite + React + TypeScript scaffold
- [x] `0.1.2` Add core deps: `@supabase/supabase-js`, TanStack Query, TanStack Table (all MIT)
- [x] `0.1.3` `.env.example`, `.gitignore`, proprietary license notice (no copyleft code — §9 licensing basis)
- [x] `0.1.4` Lint (oxlint) + Prettier + strict `tsconfig`; CI workflow: typecheck, lint, unit tests, build, and license allowlist (ADR-0002/0003) on every PR
- [x] `0.1.5` Testing harness: Vitest ✔ · pgTAP ✔ (92 suites, local runner + CI database job) · Playwright ✔ (M11) **Closed 6 Sep:** the first Playwright suite exists (`e2e/smoke.spec.ts`, 3 tests). Broadening it is `M11.1`.
- [x] `0.1.6` **Timeline library spike → ADR-0004 accepted: dnd-timeline** (headless, MIT; vis-timeline documented fallback). Both finalists passed all acceptance criteria in the working spike (`spike/timeline/`): 150 resources / ~300 bookings <0.5s, exact drag precision, 3-lane overlap stacking, blackout ranges, native RTL, hand-built EN/AR time axis. dnd-timeline is in deps; M5 unblocked.

### 0.2 Supabase & environments
- [x] `0.2.1` `maestro-dev` created (eu-central-1, new publishable-key format); **prod deferred until deployment** — free-tier projects pause after ~7 days idle, so an unused prod would sit paused (create at deploy time)
- [x] `0.2.2` Supabase CLI wired: `supabase init` done, `.env` + validated env module (`src/lib/env.ts`) + single typed client (`src/lib/supabase.ts`); local dev via `supabase start` per README
- [x] `0.2.3` Type generation live: real `src/types/database.ts` generated from maestro-dev; regenerate after every applied migration (`supabase gen types typescript --project-id <ref>`)
- [ ] `0.2.4` Deploy target for frontend + privileged API routes (Vercel per §8.4); env secrets management
- [ ] `0.2.5` Seed script with realistic Meridian-shaped fixtures (departments from org chart, sample clients incl. Kite Card / Souqly-shaped entities, equipment pool)

### 0.3 Project hygiene (mitigates "single point of knowledge", §13)
- [x] `0.3.1` `docs/adr/` — ADR log is the living decision system (ADR-0001: v15 frozen, no v16); index in `docs/adr/README.md`
- [x] `0.3.2` OD status tracked via the ADR index + the OD Gate table below (no separate DECISIONS.md)
- [x] `0.3.4` Agent governance: canonical `AGENTS.md` (structure, naming, principles, security bar) + `CLAUDE.md` and `.cursor/rules/maestro.mdc` binders + six project skills in `.claude/skills/`
- [x] `0.3.5` Anthropic skills catalog reviewed (17 skills) and applicable ones **translated into Maestro skills**: `webapp-testing` → `maestro-e2e` (toolkit + scripts adapted to our stack), `frontend-design` → `maestro-design` (design language for role surfaces, EN/AR, RTL); `skill-creator` vendored as-is (meta-tooling); document skills excluded (all-rights-reserved — ADR-0002); upstream Apache-2.0 licenses retained; see `.claude/skills/README.md`
- [ ] `0.3.3` Data-export story documented from day one (clean ownership requirement, §10.3)

---

---

## Phase L — TEAM LAUNCH (ADR-0007 deviation; supersedes MVP ordering below until shipped)

Goal: the booking calendar in production for the whole Meridian team (all roles, day one).
Sequence L1 → L5; each L-milestone ends verified before the next starts.

> **▶ NEXT SESSION (2026-08-14).**
> Decision (Edward, 2026-08-12): **Module 1 (invite + schedule) ships on AD-HOC bookings** — no
> campaign/client creation UI required (campaign builder is V1.7); users book with free-text task names.
>
> **DONE 2026-08-13:** `L1.5` offices (timezone + working week) · `L1.7` leave calendar (ADR-0013) ·
> `L3.1–L3.4` task-list views (bookings table, my tasks, per-project rollup, CSV export) · pgTAP `012`
> (leave authority). **Plus fixes:** `update-user` now syncs the linked resource's office/dept/team;
> Users screen gains a **Team** picker; booking RLS denials return a legible **403 out_of_scope** (not a
> 500); non-working days shade **red**; set-password gains a prominent **Resend-code** button + **email
> prefill** from the invite/reset link.
>
> **RESOLVED 2026-08-13 → ADR-0014 (accepted). IMPLEMENTED 2026-08-13:**
> 1. **Team-implies-department scope = YES — DONE.** Migration `20260813100000` widens
>    `app.in_write_scope` department branch to also match a resource whose team's `department_id` = the
>    lead's department. Tag Team only; department inferred. Scope pgTAP `010` extended (+2: dept lead
>    reaches team-only resource under their dept; still denied cross-department) → **plan(12)**. Verified in
>    Postgres (chain clean; dept lead books team-only own-dept resource, blocked on other-dept). **Requires
>    `db push`.**
> 2. **Self-booking = NO.** Documented rejection (ADR-0014); no code.
> 3. **Deactivation deactivates the resource = YES; bookings kept + FLAGGED — DONE.** `update-user` now
>    syncs linked resource `is_active` to the user's active state (**redeploy**). Existing bookings kept
>    (not cancelled); the bookings table flags rows whose resource is inactive + a "reassign or cancel"
>    notice (the grid filters inactive resources out).
>
> **Pilot readiness:** `L5.1` Playwright smoke suite (login → book → move → cancel → sign out + role-leakage);
> `L4` prod Supabase / Vercel / runbook (Edward's hands-on).
>
> **Chat & Huddle architecture — DONE (ADRs accepted 2026-08-13; analysis in `docs/realtime-architecture-assessment.md`):**
> 3. ✅ **ADR-0015 (chat & notifications):** Supabase **Broadcast** (NOT Postgres Changes), Postgres = source
>    of truth, **persist-first reliability** (client-generated idempotent `id` + per-conversation `seq` +
>    client outbox + reconnect catch-up, with native Broadcast Replay), **native Supabase in-app inbox** (Novu dropped — ADR-0026). **Durable
>    Objects + SpacetimeDB rejected** (SpacetimeDB = 2nd source of truth + BSL license). Build on official
>    permissive parts (Supabase Broadcast chat component + slack-clone schema). Tasks → **V1.6**.
>    Cross-tenant threads still wait on M8.
> 4. ✅ **ADR-0016 (voice huddles):** LiveKit (Apache-2.0), **Cloud-first, self-host fallback**, audio-first,
>    connect-only-in-meeting. **Recording (OD 27 decided):** cloud-first R2 (TTL) → **permanent copy to
>    tenant-local backup** (Iraq/Egypt lack usable cloud); **host/primary tenant owns** the recording even
>    with external invitees. **Voice MUST traverse corporate firewalls — hard requirement (Edward):** OD 28
>    escalation spike (embedded TURN TLS 443 → coturn → in-region self-host) **gates the entire huddle build**.
>    Consent mechanism + per-jurisdiction legal review still required. Tasks → **V1.10**.
>    - **Scope note: LiveKit is needed for HUDDLES ONLY — chat needs zero new infra** (Supabase Realtime).
>    - **Self-host components (server infra, not physical hardware):** SFU media server · **TURN/coturn**
>      (public IP, TLS 5349/443; the NAT-traversal piece the restricted-network test must prove) · Redis ·
>      **Egress** recording service (resource-hungry; audio-first keeps it cheap) · open UDP media range
>      (~50000–60000) + signaling 7880 · recordings → B2. Meridian scale is small — ~1–2 small VMs (a 4-core box
>      does ~100–150 concurrent), so the cost is **ops burden**, not horsepower.
>    - **Deploy decision = self-host vs LiveKit Cloud (managed).** Cost researched 2026-08-12 (livekit.com/pricing):
>      billed on **WebRTC participant-minutes**. Free tier 5,000 min/mo (≈ a small pilot); **Ship ≈ $50/mo**
>      = 150,000 min — full internal rollout at our size uses only ~10–15% of that; Scale ($500) is for
>      heavy constant recording, not us. Recording/egress + data transfer are **extra meters** (audio-first
>      keeps them low). **At our scale Cloud (~$0–50/mo) ≈ self-host compute + ops time** — so this is
>      **NOT a cost decision**. The real deciders: Cloud is a **paid dependency (ADR-0002 sign-off)** and puts
>      **client voice recordings on a 3rd party** across Iraq/UAE/Egypt (**OD 27** consent/data-residency).
>
> **Operational reminders (git does NOT deploy these):** after pushing, redeploy the Edge Functions —
> `supabase functions deploy update-user` and `booking-transition`; re-paste `invite.html` +
> `reset-password.html` into Supabase → Auth → Email Templates (the email-prefill links live there, not in
> git); keep both templates on the `{{ .Token }}` code versions (ADR-0012). Deploy order for schema work =
> **migration first, then frontend**. CI is green; the remaining pre-pilot gate is `L5.1` + a real click-through.

### L1 — RBAC & data administration (launch blocker: today only seed scripts create data)
- [x] `L1.1` Admin → Users: list (name, email, role, office, active, linked resource), invite form (drives the existing `invite-user` function), per-user actions — `/admin/users`; two-step deactivate; send-reset action; `user_profiles.email` mirror (migration `20260801090000`). **Add (2026-08-13):** inline **Team** picker (labelled "Team · Department") alongside role/department/office — writes `user_profiles.team_id` + JWT claim (and syncs the linked resource once `update-user` is redeployed). ⚠️ deactivation does not yet deactivate the linked resource — see NEXT-SESSION open decision 3.
- [x] `L1.2` `update-user` Edge Function (admin-only): change role (updates app_metadata claim + profile **atomically** — never one side), change office/locale, deactivate/reactivate (bans auth user + flags profile); audit events on every change — plus column-privilege lockdown: role/is_active/email not client-writable (pgTAP `006_user_admin_lockdown`). **Fix (2026-08-13):** office/department/team changes now also sync the linked bookable resource (ADR-0011) — previously only `user_profiles` was updated, so the grid (which shades non-working days off the *resource's* office) never changed. **Redeploy `update-user` for this to take effect.**
- [x] `L1.3` Set-password flow for invited users + forgot-password. **Reworked to CODES (ADR-0012):** corporate link scanners (secure-email gateways) pre-fetch and consume single-use magic links, so `/set-password` is now a code screen — enter email + `{{ .Token }}` code → `verifyOtp` → `updateUser({password})`. Accepts Supabase's configurable **6–10 digit** OTP length. Show/hide password toggle (default hidden); specific error messages (invalid/expired code, weak, same-as-old, rate-limited, mismatch); no redirect/allowlist dependency. Code-led EN/AR email templates versioned in `supabase/email-templates/`. **Edward:** paste both templates into Supabase → Auth → Email Templates; turn OFF Resend click/open tracking. **Add (2026-08-13):** prominent **Resend-code** button (outline pill + hint, EN/AR) — emails a fresh recovery code, notifies the user, surfaces rate-limits; a resent code always verifies as `recovery`, so an expired **invite** self-recovers without re-invite. Invite/reset links now carry `&email={{ .Email }}` and `/set-password` **prefills the email** (avoids a mistyped address that silently fails `verifyOtp`). ⚠️ re-paste both templates after this change.
- [x] `L1.3a` 🎨 Design system from `E2EV1.pen`: (1) tokens applied to `src/index.css :root` — violet primary `#614CFF` (was blue), warm neutrals, semantic soft colors, 8/12/16 radius scale, Inter/Sora/IBM Plex Sans Arabic families (system fallback) — whole app re-skins via tokens; (2) **auth screens (login/forgot/reset) rebuilt to the split-screen layout** (frames 13–15) via shared `AuthLayout` (dark brand panel + form card), with password reveal + strength meter; (3) **Maestro branding** — logo mark (`public/maestro-mark.png`, on a white chip on the dark panel) + wordmark, "Traffic & Resource Management Suite" tagline, "how **the team** plans" copy, **version + In-development** tag; (4) logo wired into the **app shell** and the **favicon** (ico/png/apple-touch); (5) **SSO placeholder removed** — multitenant system, no single-org (Kite Group) SSO; (6) **app shell rebuilt to the concept sidebar layout** (frame 01): 248px dark sidebar (Maestro logo + suite label, grant-scoped nav in Main/Admin sections with icons, user block pinned bottom) + 64px topbar (search placeholder, Alpha·version, feedback, locale) — replaces the header menu; (7) **Overview dashboard** (`src/features/dashboard/`) renders at **`/admin`** — the **Power Admin's landing** (its `roles.default_route`); all other roles keep their **role-aware scoped landing** (unchanged, ADR-0008). Live tenant-scoped stat cards (people, bookable people, equipment/rooms, teams, departments, bookings this week); gated on admin view grants. **Follow-up:** self-host the web fonts (open M2.4); true SVG logo when a vector export is available; wire the topbar search (currently a placeholder); richer dashboards land at M7 / V1.5 / P2.4. **Fixes (2026-08-15):** shell **locked to the viewport** (`.shell` 100vh + `overflow:hidden`) so the sidebar/user block stays put while only the main content scrolls; the **Overview** link is renamed **Dashboard** and is now a **universal home link** in the sidebar (→ each role's landing route) instead of an admin-only item.
- [x] `L1.4` Admin → Resources: CRUD (kind, capacity model + params, office, department, team, approval flag, **nickname**, rates admin-only-visible, active); link/unlink user — **ADR-0011** DONE (`/admin/resources`: table + create/edit dialog, humans forced load_based, activate/deactivate, link/unlink login, 🎲 nickname; rates gated behind resources:manage as interim — column-level protection still L1.6)
- [ ] `L1.5` **Everything named in this entry is DONE (re-verified 26 Aug, again 6 Sep). Follow-up
  (b) — the reference-file upload — is now BUILT and tracked as `I14.6`; it files campaign
  references from step 2 of the wizard. The only work left is (c), an `is_system` folder
  protect-trigger: `asset_folders` carries the column and the UI honours it, but the only trigger on
  that table is `set_updated_at`, so the protection is presentation and nothing more. Follow-up (a)
  became ADR-0023 and is tracked as `I11.4`.** Original entry: Admin →
  Organization: offices (timezone, working week), departments, teams, clients, projects (campaigns) CRUD — **departments + teams + offices DONE** (`/admin/organization`, counts + rename/edit + guarded delete; teams nested under departments, dept-scoped add — ADR-0009; **offices** create/edit dialog with IANA timezone + working-week picker writing `working_days` per ADR-0005 — grid non-working-day shading depends on it — counts of people + resources per office, RLS via `organization:manage`); **clients + brands CRUD DONE (2026-08-15, ADR-0020 Phase A):** registered internally, name + Odoo code + brands (nested) + campaign counts. **Campaign Builder / Brief Wizard DONE (2026-08-16, ADR-0020 Phase B) — see V1.7.** **Client Registration moved to its own Client-Services surface (`/clients`, ADR-0021, 2026-08-16):** off Admin → Organization onto a dedicated form + list; split grants `clients:view` (AM/Scheduler/Power Admin, tunable) / `clients:manage` (AM/Power Admin) replace `organization:manage` on client/brand writes; `clients.profile jsonb` holds the general business profile (required core + optional, conditional e-comm/app sections) — the durable half of the performance intake, authored once and inherited by briefs. (V1.7)
- **Asset filing + reference library (ADR-0022, 2026-08-16) — DONE.** Schema (`asset_folders` tree + `assets` + `asset_versions` + `asset_references`), `assets:view`/`assets:manage` grants, and auto-provisioning triggers seeding each client's filing structure on creation (Client → Brand Assets → per brand → Logos/Fonts/Guidelines/Key Visuals; Projects → per campaign → Working Files/Deliverables/Final Assets/References), backfilled for existing clients. Storage on **Backblaze B2** (bucket `Maestro-Assets`, eu-central-003) via the `asset-url` signed-URL Edge Function (deployed; bytes never touch the app). **Library UI** (`/library`, gated `assets:view`): by-client folder-tree browse + company-wide search + folder create/delete (`assets:manage`) + upload/download wired to B2. **Follow-ups (parked):** (a) **deliverable review-versioning ↔ Library reconciliation** — needs an ADR once the creative director decides unify-vs-reference, plus PDF/doc page-anchored feedback (schema extension); (b) **reference-file upload step in the Brief Wizard** auto-filing into the campaign's References folder; (c) **`is_system` folder DB protect-trigger** (system-folder protection is UI-only today); (d) **Iraq on-prem archive sync**. (L1.5)
- [x] `L1.24` **Everything is logged, and it stays logged — DONE 6 Sep.** Edward, on finding
  department brief approvals absent from the trail: *"there should be a standing rule in the project
  that all actions require full audit logging."* **The failure was structural, not a lapse.**
  `20260802103000` attached `app.audit_row_change()` to a hand-written array of 22 tables — right on
  2 August and wrong from the next table onwards. Seventeen tenant-scoped tables were created after
  it and none was added: every brief, brief template, concept, deliverable type, workflow template
  and asset table built since, plus attendance and both settings tables. **Nothing failed for a
  month**, and the audit screen looked complete throughout. `20260906140000` attaches the trigger to
  all of them. **The rule is now enforced rather than remembered:** `AGENTS.md` §6 carries it beside
  RLS in the same sentence shape (*"in the migration that creates it"*), the `maestro-migration`
  skill puts the trigger in its worked example and its checklist, and pgTAP `092` fails the build
  naming any tenant-scoped table without it — proved by removing `campaign_briefs` from the list and
  watching it fail. **Four exemptions, each argued for in the test:** the logs themselves
  (`audit_events`, `sla_events`) and the content that already IS the record (`notifications`,
  `messages`); a fifth needs an ADR. `task_time_entries` was on that list for a day and should not
  have been — it carries the trigger and has 127 events in the live log, so the exemption was a
  statement nobody could act on. Removed, and the assertion is stricter for it. Nineteen entity labels
  added in both languages so the new rows read as *"Department brief"* rather than a table name.
  **Volume, stated rather than discovered:** attendance writes about two events per person per
  working day and asset versions one per upload — both included on the rule, and if that proves
  wrong the answer is a retention policy, not an exemption. Both migrations applied 6 Sep; verified against the live log, where the
  seventeen tables now appear as soon as something changes in them.
- [x] `L1.23` **The audit log can be walked and narrowed — DONE 6 Sep.** Edward: *"the audit log
  only shows me the last 200 entries, I need a means to filter to different ranges or to scroll
  through the entries not listed."* It was a bare `.limit(200)` with no way past it, so anything
  older than the last 200 events existed in the database and **could not be reached from the product
  at all** — on a log gaining thousands of rows a month that is most of it. Now keyset paging (older
  than the last row I hold, not "skip 400", so a page cannot shift under the reader while events
  arrive and page fifty costs what page one does) plus an optional date range at either end
  independently. **The entity filter was worse than incomplete:** a hard-coded array of fourteen
  table names written in August, which had missed every table created since — briefs, brief
  templates, concepts, deliverable types, workflow templates, the asset tables. The screen looked
  complete while doing it, so a missing row read as *"nothing happened to briefs"* rather than
  *"this list has not heard of briefs"*. It now comes from the log itself
  (`audit_event_entities`, `security_invoker` so `audit:view` still decides who sees anything),
  carrying counts so the filter says whether an option is worth opening. Two compound indexes,
  because the existing three cover one column each. pgTAP `092` asserts the fence rather than the
  counts — another tenant is invisible, and a caller without `audit:view` gets nothing, which a
  `security definer` view would have failed silently. Seven frontend tests. Migration
  `20260906130000` applied 6 Sep — the filter now lists 32 entities from the log itself.
- [ ] `L1.6` 🔒 pgTAP additions for any new policies + role-scope leakage check (rates never readable below admin — column-level protection decision needed here)
  - ✅ **ADR-0013 leave policy covered:** `supabase/tests/012_leave_authority.sql` (12 assertions) — catalog + Power-Admin coverage, `leave:manage` writes leave/holiday/emergency, kind-fence blocks maintenance, category CHECK, no-reclassify (WITH CHECK), deny-by-default, scheduler unaffected, cross-tenant blocked. Logic verified in local Postgres; pgTAP harness runs in CI. Rate column-level work below is still open.
  - ⏸️ **PARKED (Edward, 2026-08-12):** rate *visibility & editing* is a **finance / department-lead** concern, NOT a general resource-manager or invite concern. Rates must **never** appear on the invite screen (they don't today — invite is toggle + nickname only), and on the Resources screen the current interim gate (`resources:manage`) is too broad. Follow-through: give rates their own permission (e.g. `resources.rates:view`/`edit`, or a `finance:*` grant) held only by finance + department lead, enforced at the column level (this task). Until then, keep rate fields off every provisioning surface.
- [x] `L1.7` Leave calendar owned by People & Culture — **DONE (ADR-0013)**. New `leave:view`/`leave:manage` permissions (no seeded role — the HR/leave role is admin-composed on the Roles screen and org-wide by the tenant-scope default); leave calendar surface at `/people/leave` (People nav section, gated `leave:view`) records staff leave (incl. emergency via `category`) + company holidays → `resource_unavailability`, shown on the grid. RLS: scope-respecting, kind-fenced (`leave`/`holiday`) write policy OR-combined with the scheduler `blackouts:manage` policy; `category` column (planned/emergency/sick/unpaid) added. Maintenance stays a scheduler concern. Migration `20260813090000` verified (chain clean, policy matrix + Power-Admin coverage proven in Postgres). Full pgTAP for the new policy = **L1.6 follow-up**
- [x] `L1.8` ⚙️ ADR-0008 RBAC schema migration: `roles` (tenant-scoped rows; Power Admin + Client Portal `is_system`; Scheduler/Department Lead/Team Member starters), `role_grants` (deny-by-default role × resource × action), `user_profiles.role_id/department_id/job_title`, claim cutover `app_role` → `app_role_id`, `app.has_permission()`, rewrite ALL policies off `app.is_admin()`; cutover maps existing admin → Power Admin
- [x] `L1.9` ⚙️ ADR-0008 universal audit: table-level audit triggers on every business table → `audit_events` (actor, entity, changed fields) so direct PostgREST writes are captured; append-only enforcement re-proven
- [x] `L1.10` ⚙️ ADR-0008 function + frontend rewire: `invite-user`/`update-user` target `role_id`; grants fetched at sign-in; nav/guards/`default_route` grant-driven (drop `ROLE_HOME`/`ROLE_NAV` hardcoding); Users screen gains role (from roles table), department, job title
- [x] `L1.11` ⚙️ ADR-0008 Admin → Roles & permissions screen: create/edit roles, grants matrix editor, assign users; Power Admin-only audit trail view
  - ✅ **Audit log made human-readable (2026-08-15):** machine actions → friendly labels (`Invited user`, `Created`, `Moved booking`…), entity table → plain name **+ the record's resolved name** (e.g. *User · Edward Batt*), and the payload rendered as **`Label: value` pairs with UUIDs resolved to names** (role_id→role, department/team/office/user→names; booleans→Yes/No; timestamps formatted; internal id/tenant fields hidden). `useAuditLookups` batch-resolves id→name maps; `audit-format.ts` holds the label maps (i18n, EN/AR, humanise fallback so new events never render blank). No schema change.
- [x] `L1.12` 🔒 ADR-0008 pgTAP: forged/absent grants deny, cross-tenant role/grant isolation, `is_system` role protection, Power Admin = full catalog coverage, audit triggers fire on every table
- [x] `L1.13` ⚙️ ADR-0009 org sub-layer + lead roles: `teams` (Department → Team → people; `user_profiles.team_id`, `resources.team_id`); `roles.scope` (tenant/department/team/account/self); **Team Lead** + **Account Manager** seeded starters (amends the L1.8 role list); Teams admin UI (nested under departments); header user menu (name/role/avatar/sign-out)
- [x] `L1.14` ⚙️ ADR-0010 work breakdown + scoped write authority: `sub_tasks` (deliverable → sub-task, assignee + SLA hrs/dates, capacity-consuming); Account-Manager assignment on clients/campaigns; invoker-side scope helpers + scoped write policies (sub_tasks, bookings, blackouts, series, campaigns/streams/jobs); `invite-user`/`update-user` carry `department_id`/`team_id` in the JWT; esports-site RBAC evaluated & rejected (kept the ADR-0008 grant model). **Add (2026-08-13):** `booking-transition` maps a scoped-write RLS denial (42501) to a clean **403 `out_of_scope`** with a helpful message (was an opaque 500); BookingDialog surfaces it. **Requires `booking-transition` redeploy.**
- [x] `L1.15` 🔒 ADR-0009/0010 pgTAP `010_scope_and_subtasks`: each lead denied outside its slice (team/department/account), Scheduler tenant-wide, member cannot assign but progresses own work, reads tenant-wide — CI database job green
- [x] `L1.16` ⚙️ ADR-0010 deferred: sub-task assignment **UI** · deliverables write-scoping — **DONE via Phase I (ADR-0024): `I2.3` shipped the deliverable→sub-task breakdown + assignment surface; `I1.1–I1.6` define the lifecycle + write-state ownership (guard authority + scope RLS)**
- [x] `L1.17` ⚙️ ADR-0011 internal-users-are-resources DONE: `resources.nickname` (unique-per-tenant partial index) + drop `uq_resources_tenant_name` + non-blank check (migration `20260812140000`); `invite-user` auto-creates a human resource (toggle, default ON) with an auto fun MENA nickname, race-safe re-roll on 23505, full rollback on failure; invite form gains toggle + editable nickname + 🎲 reroll and drops the manual "Link to Resource" step; shared generator `src/lib/nickname/generate.ts` (+ unit test); master grid shows name + nickname
- [x] `L1.18` 🔒 ADR-0011 pgTAP `011_resource_nickname`: name-collision allowed, nickname-collision blocked (tenant-scoped), NULL/blank handling, old/new constraint swap — 7 assertions (underlying SQL verified locally; pgTAP harness runs in the CI database job)
- [x] `L1.22` 👀 **Account activation status in the Users screen — DONE (2026-08-15, for the pilot).** A **Signup** column shows **Activated** (has signed in ≥ once, with a "last active" date tooltip) vs **Pending** (invited, not yet responded) — distinct from the Active/Inactive deactivation badge. Authoritative: a new **`list-user-status`** Edge Function reads `auth.users` (service role, gated on the caller's `admin.users:view`, scoped to the caller's tenant) since the browser can't read auth state; `useUserStatus` merges it into the Users list and **degrades gracefully** (shows "—") if the function isn't deployed. ⚠️ **Edward: deploy it — `supabase functions deploy list-user-status`.** Files: `supabase/functions/list-user-status/index.ts`, `admin-api` (`useUserStatus`), `UsersPage` (+ test). EN/AR.
- [x] `L1.21` ⚙️ ADR-0014 team↔department integrity in the admin UI — **DONE (2026-08-15)**. **Invite User** now has a **Team** picker (was missing) filtered to the chosen department; `invite-user` Edge Function already accepted `teamId` (writes profile + claim + resource) so **no redeploy**. **Users screen** filters the team dropdown to teams under the row's department and **flags a mismatch** (⚠ "Team not in this department") when the department was changed but the team wasn't — the case that silently broke Team-surface scoping. `TeamOption` gains `departmentId`; EN/AR; tests updated (mismatch flag). **Resources screen** gets the same treatment: the edit dialog already filtered teams by department + cleared on change; now it also **surfaces an existing mismatched team** as a ⚠ option (was silently blanked), and the Resources **table flags mismatched rows** so equipment/rooms with a team under the wrong department are visible for correction.
- [x] `L1.19` ⚙️ ADR-0017 seed near-universal titles — **DONE**. Migration `20260815100000` `create or replace`s `app.seed_tenant_roles` to add **CEO / COO / CFO** (oversight roles: `scope='tenant'`, `default_route='/admin'` = the Overview, **read/oversight grants only — no `*:manage`, no users/roles/organization admin**; CEO=full read incl. audit+rates, COO=+bookings:approve, CFO=finance/rates+bookings:export) and **Deputy Team Leader** (`scope='team'`, `default_route='/team'`, grants **copied live** from the tenant's `team_lead` role so parity can never drift — Option 1, whole-team reach; Edward confirmed reversible to true sub-team scoping later, additive-only). All four `is_system=false` (admin can rename/re-grant/delete). Re-seeds every tenant idempotently. **Verified in local Postgres:** 11 roles seed, deputy≡team_lead grant set, CEO/COO/CFO hold zero manage/admin-write grants, re-run is a no-op (11 roles / 136 grants stable).
- [x] `L1.20` Company Directory — **DONE (ADR-0017)**. New `directory:view` permission granted to **every internal role** (all seeded roles bar `client_portal`; Power Admin via trigger). Read-only surface at `/people/directory` (People nav section) lists every registered employee **grouped by department** — full name, **job title**, nickname (linked resource, ADR-0011), email — with a client-side name/title/nickname/email filter and an "Unassigned" bucket; external portal accounts excluded. Tables use `table-layout:fixed` + a shared `<colgroup>` so columns line up across the per-department tables. **Add (2026-08-15):** **Role** and **Office** columns (searchable too). **Fix (2026-08-15):** removed a dead, colliding bare `.sidebar` CSS rule (schedule-grid leftover; the grid uses `.dg-sidebar`/`.mo-sidebar`) that was overriding the app-shell sidebar from dark→light and making hovered nav text (white) vanish on the wrongly-light background. Reads `user_profiles` + reverse-embedded resource nickname, both already tenant-wide readable — **no new table or read policy**. EN/AR parity, RTL-correct (emails pinned LTR). `src/features/directory/*` + `DirectoryPage.test.tsx`; `nav-config.test.ts` updated for the new item.

### L2 — Calendar views (all four, per Edward)
- [x] `L2.1` Master grid filters: department / team / resource kind / office / project; filter state in URL (shareable, `?view=&dept=&team=&kind=&office=&campaign=`); rows show **name + nickname** (ADR-0011 disambiguation); options derived from the resource pool. **Fix (2026-08-15):** the **department filter was broken** — its `onChange` made **two** `setParam` calls (`dept`, then clear `team`), and react-router's functional updaters both receive the same pre-update snapshot, so the second call clobbered the `dept` set and it never applied (the single-`setParam` team/kind/office filters were fine). Fixed with an **atomic** `setDeptFilter` (sets `dept` + clears `team` in one update); **Clear filters** had the same multi-call bug (only cleared `campaign`) — now a single `clearFilters` update. Also made the department filter **hierarchy-aware** (ADR-0014): a resource tagged only with a team resolves to its team's parent department for the dropdown + match.
- [~] `L2.2` My calendar: signed-in user's linked resource — delivered as the **"My calendar"** mode in the schedule surface (filters to the login's own resource via `resources.user_id`). Creative/support **read-only surface on `/my-work`** deferred to **M6.2** (that route is still a placeholder; the role-scoped surface is M6 work)
- [x] `L2.3` Project calendar: pick project → its bookings across resources (rows = booked resources only) — "Project" mode + project filter
- [x] `L2.4` Month overview: compact per-day density (confirmed load vs ceiling) per resource; overload glyph carries over — "Month" mode (`MonthOverview`)
- [x] `L2.5` View switcher in the schedule surface (Master / My calendar / Project / Month); creatives/support are naturally scoped out of this surface (no `schedule:view`) → their My views live on `/my-work` (see L2.2 deferral)

### L3 — Task list views
- [x] `L3.1` Bookings table (TanStack Table) — **DONE**. `/bookings` (Main nav, gated `bookings_table:view`): columns date / resource (name·nickname) / task / project / hours / state / type; client sort, global search, group-by project or resource with summed hours; date-range picker. Ad-hoc-aware — task falls back notes→deliverable, project falls back campaign→job→"Ad-hoc" (Module 1 books ad-hoc until the campaign builder, V1.7). `src/features/bookings/`
- [x] `L3.2` My tasks — **DONE**. `/my-work` now renders the signed-in person's own bookings (their linked resource, `resources.user_id` — ADR-0011) via the shared table; replaces the placeholder landing (richer creative surface is still M6.2)
- [x] `L3.3` Per-project task list — **DONE**. "By project" tab on `/bookings`: pick a campaign → its tasks (deliverable name, or ad-hoc task label) with booking count + total booked hours. Degrades cleanly to an explanatory empty state while no campaigns exist (ad-hoc-only until V1.7)
- [x] `L3.4` CSV export — **DONE**. Export button on the bookings table serializes the **currently filtered** rows (RFC-4180 quoting + UTF-8 BOM for Excel/Arabic); dependency-free `lib/csv.ts` (+ unit test). First slice of the data-export story (`0.3.3`)

### L4 — Launch infrastructure ✅ (Edward, 2026-08-13)
- [x] `L4.1` Edward: create `maestro-prod` (eu-central-1, **paid tier** — no free-tier pausing), apply migrations, deploy both functions, set secrets (CRON_SECRET, service key stays in dashboard only)
- [x] `L4.2` Vercel project: build from repo, env vars (prod URL + publishable key), preview deploys from PRs; custom domain if desired
- [x] `L4.3` Supabase Auth config (prod): Site URL + redirect allowlist for the Vercel domain; email templates (invite/recovery) minimally branded
- [x] `L4.4` Environment separation in code: `.env` schema unchanged; prod values only in Vercel; confirm no dev fallbacks leak (bootstrap script's dev default URL guarded)
- [x] `L4.5` Backups/PITR confirmed on prod tier; `docs/RUNBOOK.md`: deploy steps, rollback, migration discipline against live data (ADR-0007 lock-in)

### L5 — Pilot hardening & go-live · **run sheet: `docs/PILOT-RUNSHEET.md`**
- [x] `L5.1` Playwright smoke suite **BUILT** (2026-08-13): `playwright.config.ts` + `e2e/smoke.spec.ts` + opt-in `.github/workflows/e2e-smoke.yml` (separate from `ci.yml`, never blocks it). Three layers: **deploy-integrity** (always-on, no creds — catches a broken deploy), **authed smoke** (login→shell→sign-out; gated on `E2E_EMAIL`/`E2E_PASSWORD`), **role-leakage** (team member sees no admin nav + guard refuses direct nav; gated on `E2E_CREATIVE_*`). **Edward: wire the `E2E_*` repo secrets (ideally a staging project) and run from the Actions tab.** Full book→move→cancel loop needs a seeded/disposable dataset → Phase-2 follow-up; manual version is run-sheet §2.
- [ ] `L5.2` RTL + Arabic pass — **code verified RTL-correct (2026-08-13):** logical CSS properties throughout, `dir` flips with locale, code/token blocks intentionally LTR-pinned, zero physical props in components. Residual = a 2-min **visual** glance in Arabic (run-sheet §3) — flag anything and I'll fix.
- [ ] `L5.3` Real data load: actual offices/departments/staff/resources/current projects via admin UI (retire seed-dev data on prod)
- [x] `L5.7` **A tab that has been open all week is told it is out of date — DONE 6 Sep.** Edward:
  *"users are not logging out of the site in some cases and as we are continuously updating the
  site, they are not always using the latest version."* **The cause is the bundling, not their
  habits.** Maestro ships as ONE chunk with no code splitting, so a tab that stays open never
  requests anything again: it cannot discover a release by accident and it never fails in a way that
  would make somebody reload. It quietly runs old code against a database that has moved — ten
  migrations went in on 5–6 Sep alone, and a stale tab calling for a column that has changed shape
  fails in a way that reads as a bug in a version nobody is looking at. **Two halves from one
  place** (`vite.config.ts`): `__BUILD_ID__` compiled INTO the bundle, `version.json` emitted next
  to it, so they cannot disagree. The id is the commit where CI provides one (Vercel and GitHub
  both do), which makes *"which build is she on?"* answerable from the value. `useAppVersion` polls
  every five minutes **and on tab focus** — the realistic pattern is a tab returned to after hours,
  and waiting five more would mean starting work on the old build anyway. **Non-blocking, and that
  is the whole design:** it reports, the reload is a button, the bar dismisses, and it never
  reloads under somebody half-way through a brief. **A failed check is silent** — offline, a
  captive portal, a deploy mid-flight are not evidence of a new version, and a bar that appears on
  a network hiccup is one people learn to close unread. `vercel.json` marks `version.json`
  `no-store` so the CDN cannot answer an out-of-date tab that it is current; every other asset is
  content-hashed and stays cacheable. Ten tests, including the decision as a pure function.
  **This gets more important with `L5.4`:** once routes are code-split, a stale tab starts
  requesting chunks that no longer exist and fails outright rather than running old code quietly.
- [ ] `L5.8` **The app signs in with a new-style key; all sixteen Edge Functions validate with the
  old-style one.** `src/lib/env.ts` requires `VITE_SUPABASE_PUBLISHABLE_KEY` to start `sb_publishable_`,
  while every function reads `SUPABASE_ANON_KEY` (the legacy JWT anon key) to build the client it
  calls `auth.getUser()` on. Both work today because Supabase still injects both. **The failure mode
  is that all sixteen stop at once** when the legacy format is retired, and it will look like an
  auth outage rather than a key change. Noticed 7 Sep while diagnosing a `subtask-schedule` 401 that
  turned out to be a stale session, not this. Decide the migration before the platform decides it.
- [ ] `L5.4` Perf check at real pool size; fix pagination/virtualization if needed. **Includes bundle optimization:** the build emits a >500 kB single-chunk warning (harmless — the app ships as one chunk). Fix here, deliberately: route-based code-splitting (`React.lazy` + a `Suspense` fallback per route in `router.tsx`) and vendor chunk splitting, then measure load time. Deferred until this pass on purpose — not silenced (keep the warning as the signal). Do NOT just raise `build.chunkSizeWarningLimit`.
- [ ] `L5.5` Pilot week: bookers + leads live first, creatives read-only day 3+; feedback list triaged into tracker
- [ ] `L5.6` Go/no-go checklist + rollback plan executed; project status doc updated — **checklist in run-sheet §7**

**Deferred by ADR-0007 (unchanged in the sections below, not deleted):** M6 remainder, M7 full dashboard, M8 joint-project RLS suites, M9 campaign calendar, M10 client portal, M11 as written (subsumed partly by L5).

---

## Phase I — Internal Delivery Loop (ADR-0024; sequenced **before** M8/M10/P2)

Goal: within a **single tenant**, a deliverable travels **brief → sub-tasks → produce → internal review (rounds) → internal sign-off → done**, with contextual chat + notifications throughout — proven as a role walkthrough before the client portal (M10) or joint projects (M8) are built. SLA is **manual** this phase (existing `due_at` + `revision_round`, warn-and-allow); the full accountability engine (P2) drops in later without reshaping states/events. Fulfils and supersedes the ordering of M6.1–6.3, L1.16, V1.4.1, V1.6.1–6.5, V1.7.3/7.4, V1.8.1–8.3.

### I1 — Deliverable & sub-task lifecycle engine
- [x] `I1.1` Extend `deliverable_state` with **`blocked`** (its own migration — enum-extension naming rule); define legal deliverable transitions (`draft→in_progress→in_review→approved→(delivered)→archived`, `in_progress⇄blocked`, revision `in_review→in_progress`)
- [x] `I1.2` **`deliverable-transition` Edge Function** — caller-run (RLS + ADR-0010 scope enforced), pure state machine `src/lib/deliverables/state-machine.ts` (table-driven from→to tests, legal + illegal), optimistic-concurrency guard, audit + `sla_events` per transition (mirrors `booking-transition`)
- [x] `I1.3` 🔗 **Sub-task ↔ scheduling:** add `bookings.sub_task_id`; assigning a sub-task with assignee + hours + dates materialises a booking on the assignee's linked resource via the capacity engine (warn-and-allow; exclusive/pooled unchanged); edit reschedules, done/cancel releases — **every sub-task under a deliverable shows on the grid and consumes load** (realises ADR-0010 "capacity-consuming sub_tasks")
- [ ] `I1.4` Revision loop — **HALF BUILT; un-ticked 2026-08-28.** `in_review→in_progress` increments `revision_round` ✅ and `deliverables.revision_limit` is stored and rendered as "2 / 3" on `/deliverables` ✅. Two specified halves were never written:
  - [ ] `I1.4a` **The per-work-type default does nothing.** `deliverables.revision_limit`'s own comment promises *"Effective limit = coalesce(this, work_type)"* (`20260817110100:17`) — that coalesce exists nowhere. Setting a revision limit on a work type has no effect at all. ADR-0051/0056 move this setting to `deliverable_types`, so implement the coalesce **there**, not on `work_types`.
  - [ ] `I1.4b` **There is no warn.** The spec says warn-and-allow; `DeliverablesPage.tsx:197` prints the fraction as plain text, so "4 / 3" renders exactly like "1 / 3" and nothing tells anyone a limit was blown.
- [x] `I1.5` Internal sign-off `in_review→approved` gated `reviews:moderate` (audited: who/version/when → `sla_events` `approved`); reject-with-reason → `in_progress` (`sla_events` `revision_requested`). **`approved` ≠ client approval** (deferred, M10)
- [ ] `I1.9` **One company clock: Iraq, stated on screen — and a deadline is 18:00, not midnight.**
  Edward, 8 Sep: *"all dates and time to be specified in IRAQ time… and this needs to be stated when
  presented. also the time generated is always midnight. it should be 18:00 iraq as this is the
  office close each working day."* **This ANSWERS `I1.7`**, and with a third option neither of us
  put on the table: not "store a day as a day", but "a deadline is a real moment — end of business —
  so store it as one and the ordinary timestamp rules apply". **ADR-0076, accepted 8 Sep** — written and approved BEFORE any code, which `I41.7` exists because the previous change was not.
  Scope: `deliverables.due_at` / `sub_tasks.due_at` move from 00:00 UTC to 15:00 UTC (18:00
  Baghdad), which is a **data migration over existing rows**, not only new writes; **13 render
  sites** across 12 files stop slicing the ISO string and format in `Asia/Baghdad` with the zone
  named; the writers in `DeliverablesPage` stop stamping `T00:00:00Z`.
  **Keep the distinction the ADR must make explicit:** scheduling MATHS stays per-office (ADR-0005 —
  which day a booking falls on, the working week); only what a reader is SHOWN becomes one clock.
  Conflating them breaks the grid for Dubai and Cairo.
- [x] `I1.7` ~~⚠️~~ **CLOSED by ADR-0076 (8 Sep) — a deadline is now a real moment, 18:00 Iraq, and neither of the two options below was taken.** Original entry: **A deadline is a DAY stored as a MOMENT (Edward, 1 Sep — decision needed, likely an
  ADR).** `due_at` / `go_live_at` / leave dates are `timestamptz`, but a deadline is picked as a day
  and written as midnight UTC (`DeliverablesPage.tsx:527,593` — `${day}T00:00:00Z`). The nine
  `slice(0, 10)` renders therefore read correctly only by ACCIDENT: they print the UTC day, and every
  current user is east of UTC. Displaying them in local time — which is the right rule everywhere
  else, and is what `I3.4`/`I4.4`/`I5.3`/`I3.5` now do for real timestamps — moves a deadline back a
  day for anyone west of UTC. **Options put to Edward:** (1) store a day as a `date` and display it
  as one — migration + every reader/writer incl. the scheduler, but the problem is gone; (2) pin
  those nine to UTC deliberately with a comment — an hour, but the app then carries two date rules and
  the next person must know which is which; (3) hold — nothing is visibly wrong today. **Recommended:
  (1), after Part 4 of the acceptance run**, not mid-run; (3) is a defensible hold until then.
  Not a display bug: the display rule is right, the stored value is a day pretending to be a moment.
- [x] `I1.6` 🔒 pgTAP: transition authority by scope/grant, append-only events, sub-task→booking capacity path, cross-tenant isolation (`supabase/tests/015_deliverable_lifecycle.sql`, `016_subtask_schedule_override.sql`)

### I2 — Work surfaces (the discipline "swimlanes")
- [x] `I2.1` Deliverable/sub-task API hooks + **deliverable detail** — **COMPLETE (verified 26 Aug):**
  the two panes this entry was waiting on both landed — versions/rounds/review as `ReviewPanel` (`I3.1`—`I3.3`)
  and the item thread as `ChatPanel` on `DeliverablesPage` (`I4.2`). Original note: (versions · rounds · review · linked bookings · chat) — *API hooks + sub-task-level detail landed with `I2.3` (`src/features/deliverables/api/deliverables-api.ts`); versions/review/chat panes still pending I3/I4*
- [x] `I2.2` Creative **My Work** (fulfils `M6.2`): assigned work grouped Needs-attention / In-revision / Coming-up → deliverable detail — panel on `/my-work`, `src/features/deliverables/MyWorkPanel.tsx` (deep-links into `/deliverables`)
- [x] `I2.3` Team Lead **deliverable → sub-task breakdown + assignment** (unblocks `L1.16`; extends `M6.3`): assign owner + hours/dates → booking (I1.3) — `/deliverables` (gated `project_tasks:manage`), `src/features/deliverables/DeliverablesPage.tsx`
- [x] `I2.4` **Per-discipline stream pipeline / board views** — deliverables & sub-tasks as stage columns per stream (the swimlane surface: Production / Influencer / Creative / Performance) — `/pipeline` (gated `project_tasks:manage`), `src/features/deliverables/PipelinePage.tsx`
- [x] `I2.5` Account Manager campaign → stream → deliverable status view — reached from the campaigns list (`/campaigns/:campaignId`), `src/features/deliverables/CampaignStatusPage.tsx` (done/blocked/overdue rollup per stream)
- [x] `I2.6` Booker surface confirm (`M6.1`) + role-scope leakage audit (`M6.5`) — **COMPLETE
  (verified 26 Aug):** the audit half was already done; the booker-surface half is `/schedule` in daily
  use through the pilot — timeline + availability, filters, no performance data. Original note: over the new surfaces — *audit half DONE: `supabase/tests/017_surface_scope_leakage.sql` (sub-task UPDATE/DELETE scope + self-path, cross-tenant isolation, pins the grant-only deliverable-transition interim); booker-surface confirm (`M6.1`) still open*

### I3 — Internal review, Tier-2 (fulfils V1.8.1–8.3; internal source only)
> ✅ **ADR-0025 (accepted 2026-08-18)** settles the design: uploaded cuts are monotonic `media_records` versions reached via a privileged `review-media` Edge Function minting presigned B2 PUT/GET (no keys/bytes through the app); anchored feedback with `round` server-stamped to `revision_round + 1`, `source` internal; inline playback for web-native types, link-out otherwise; `media_records`/`review_feedback` RLS moved off `jwt_role` to grant-driven. **OD 17 (no transcoding) + OD 18 (Frame.io link-out only) stay open.** Client delivery/Library stay ADR-0023/M10.
- [x] `I3.1` Version upload + web playback/view over the `media_records` version chain — `review-media` Edge Function (presigned B2 PUT/GET), `media_records` version-stamp trigger + grant RLS (migration `20260818100000`, pgTAP `018`), `ReviewPanel` in the deliverable detail (`src/features/deliverables/ReviewPanel.tsx`)
- [x] `I3.2` Pinned x/y (image) + timecoded (video) comments, resolved-state (`review_feedback`) — round/source stamp trigger + grant RLS (migration `20260818110000`, pgTAP `019`); comment pane in `ReviewPanel` (image pins, video timecodes, resolve)
- [x] `I3.3` Review rounds tied to `revision_round`; maker jump-to-comment; **source = internal** (client-source arrives with M10). Upload-format (OD 17) + Frame.io coupling (OD 18) stay open — web-playable + link-out default — round grouping + jump-to-comment in `ReviewPanel` (`lib/review-rounds.ts`)
- [x] `I3.4` **A comment carries the time it was written, and a video note stamps itself (Edward, 1 Sep, from live testing).** Two halves. **(a) Posted-at.** The comment line showed anchor + author and nothing else: `createdAt` was fetched and mapped (`review-api.ts:238`) and then rendered nowhere, so a round read as an undated wall of notes. Every comment on a version is listed at once — deliberately, since revealing each one only as the playhead reached it would hide most of the feedback most of the time — which is exactly why the posted time is the only thing that orders them for a reader. Now a `<time dateTime=…>` in the meta line, same `Intl.DateTimeFormat` (`dateStyle: medium` / `timeStyle: short`, `ar` else `en-GB`) as the audit and feedback logs, on the trailing edge via `margin-inline-start: auto` so it mirrors under RTL — unlike the image pins beside it, which stay physical because the image is not mirrored. **(b) The timecode stamps itself.** `review.markTime` read *"Comment at current time"* — a label promising a wall clock, delivering a video position, and gating both behind a button press at the one moment a reviewer is least likely to remember an extra click. The playhead is now captured on the **first keystroke** and frozen there: pause on the frame, start typing, done. Frozen at the first keystroke rather than read at submit, because a video left rolling while someone writes a sentence would stamp the note wherever it drifted to — a number that looks authoritative and points at the wrong frame. Opt-out is explicit and reversible (*"Comment on the whole video"* → *"Stamp this point instead"*, which re-reads the playhead at that moment), and the composer states the stamp in words rather than implying it with a highlighted control. EN/AR. **The persistence path was never broken** — capture, insert, read-back and render all verified against the code; the defect was that nothing pressed the button and nothing showed the time. Frontend only: no migration, nothing to deploy. Six tests over the two halves — both clocks on one comment (1:23 into the video, posted on the 19th, asserting the machine-readable `datetime` because CI's timezone is not pinned), auto-stamp, the freeze under a playing video, drop-to-unanchored (asserting *no* anchor key, not a 0:00 one) and re-take. Typecheck + lint + 1356 tests green.
- [x] `I3.5` **The version line joins the rest (Edward, 1 Sep — Option A).** `ReviewPanel`'s version
  chain still rendered `createdAt.slice(0, 10)` two lines above comments that had just been fixed, so
  one panel showed two styles of date. Same treatment, and the formatter is now a single `useStamp()`
  shared by both halves of the file instead of a second copy. **Boundary written down in the code:**
  `useStamp` is for a moment that HAPPENED; a due date must not go through it, because a picked day is
  stored as midnight UTC (`DeliverablesPage` writes `${day}T00:00:00Z`) and local display would move
  the deadline back a day west of UTC. That is a defect in how due dates are STORED, tracked
  separately. 1360 tests green, incl. UTC+14 / UTC−11.

### I4 — Contextual chat (fulfils V1.6.1–6.5; single-tenant)
- [x] `I4.1` `conversations`/`messages` + RLS (tenant-internal), **Broadcast** transport (ADR-0015), persist-first (client id + per-conversation `seq` + reconnect catch-up + optimistic retry). **Context anchor** (`context_type` + `context_id`, one per entity — **ADR-0027**). Migrations `20260818120000` (spine, pgTAP `020`) + `20260818130000` (Realtime Authorization, guarded); `chat` Edge Function (open/send). *(IndexedDB outbox across reload = follow-up.)*
- [x] `I4.2` **Campaign room + item threads** (**ADR-0027**, option A): `chat` open() authorizes vs the campaign team, get-or-creates the context conversation, joins the caller; `ChatPanel` in the deliverable detail (item thread) + campaign status page (campaign room), live Broadcast + optimistic send. *(Typing/presence deferred per cost discipline.)*
- [x] `I4.3` Native Supabase in-app inbox — **SHIPPED under `I5.2` (verified 26 Aug):** bell + unread
  badge + mark-read, live-subscribed, mounted in `AppShell`. Original note: — **folded into `I5` (notifications)**: recipient-scoped `notifications` table + Realtime topic + in-house UI (**Novu dropped — ADR-0026**). **Cross-tenant threads deferred to M8.**
- [x] `I4.4` **A message says when it was sent (Edward, 1 Sep — the chat half of `I3.4`).** `createdAt`
  has been on every message since `I4.1` and was rendered nowhere, so a thread was an ordered list
  with no time in it: you could see a decision came after a question, never whether the gap was four
  minutes or four days. In a room whose purpose is accountability for work (ADR-0062) that gap is
  most of the meaning. Time-of-day per message, **date only on a divider where the day turns over** —
  stamping the full date on every line repeats nine characters down a 200-message thread to say
  nothing new. Same `Intl.DateTimeFormat` locale rule as the review panel and the audit log; days are
  computed in the READER's timezone. `ChatPanel` only, so `/chat` and both embedded surfaces get it
  from one change. Frontend only; no migration, nothing to deploy. Two tests, both timezone-proof
  (the divider count is asserted from timestamps a minute apart, which no real UTC offset can split
  across two local days) — verified green at UTC+14 and UTC−11 as well as locally. 1358 tests green.

### I5 — Notifications (fulfils V1.4.1)
- [x] `I5.1` (`I5a`) Event → notification on: assigned, review-requested, changes-requested, blocked, signed-off — in-transaction `SECURITY DEFINER` emission triggers (ADR-0015 pattern). **`due_soon` deferred** with its scheduled sweep (no `pg_cron` yet).
- [x] `I5.2` Delivery — **in-app (native Supabase inbox, `I5b`) + email (`I5c`)**. Inbox: bell + unread badge + mark-read, live-subscribed (ADR-0026). Email: a **per-event, high-signal slow lane** (all types **except `due_soon`**), actor-excluded, guarded `pg_net` → `notify-email` (Resend direct, idempotent, localized) — **ADR-0028**. **No email opt-out yet → `I5-follow`.**
- [x] `I5.3` **A notification says when it arrived (Edward, 1 Sep — completes `I3.4`/`I4.4`).** The row
  rendered `createdAt.slice(0, 10)`, which was wrong three ways at once: it ignored the locale, so AR
  readers got Latin digits in Gregorian order; it printed the **UTC** calendar day, so a late-evening
  notice showed tomorrow's date to anyone west of UTC and today's to anyone east of it; and it carried
  no time, so *"did this arrive ten minutes ago or yesterday?"* — the one question an inbox exists to
  answer — could not be answered from the inbox. Now a `<time dateTime=…>` through the house
  `Intl.DateTimeFormat` (`dateStyle: medium` / `timeStyle: short`, `ar` else `en-GB`). Absolute, not
  relative: *"2h ago"* needs a ticking clock to stay honest and a stale one reads as fresh. Frontend
  only; no migration, nothing to deploy. One test, asserting the `datetime` attribute and that the raw
  ISO day is gone — green at UTC+14, UTC−11 and UTC+3. 1359 tests green. **Not touched:** the ~9 other
  `slice(0, 10)` renders are DUE dates, a different job — a calendar day the business agreed, which
  must stay UTC-anchored (`AssessmentNotice.tsx` shows the pattern) rather than shifted into the
  reader's zone.
- [ ] `I5-follow` Email preferences: per-user on/off (then per-type); `due_soon` email once the deadline sweep exists.

### I6 — Phase exit
- [x] `I6.1` Role walkthrough e2e in one tenant: sub-tasks assigned → in_review → review round (media + anchored feedback) → changes (revision++) → re-review → internal sign-off → delivered, with **notifications firing to the right people** (recipient-scoped, actor-excluded: assignee + AM) and **chat membership-gated** to the deliverable. CI-runnable backend proof = pgTAP `023_phase_i_walkthrough.sql`; the UI Playwright smoke (`L5.1`, `npm run e2e`) stays the separate opt-in against a deployed URL.
- [x] `I6.2` RTL / Arabic pass on all new surfaces — full EN/AR i18n parity (884/884); `dir=rtl` flip verified; fixed two RTL defects: **review pins** now use image-space physical `left/top` (were `insetInlineStart` → mirrored under RTL, and cross-locale-inconsistent), and the campaign-status **back-arrow** flips under RTL. No hardcoded strings; chat/inbox/badge use logical properties.

**Phase I complete** — internal delivery loop proven single-tenant end to end (work → review → sign-off) with contextual chat + in-app/email notifications.

### I7 — Internal projects, booking-based assignment, SLA profiles, KPIs (ADR-0029, accepted)
- [x] `I7.1` (backend) Internal clients (internal `job` owner: tenant/department/team; `client_id` never nullable; shape constraint + partial-unique identity; fenced from external surfaces); **Scheduler role retitled Traffic Manager**; **setup via existing `projects:manage`** (Traffic Manager / Power Admin — no new grant, no `jobs`-policy change); **per-project PM** (`owner_user_id`) gets project-scoped sub-task authority across departments (`app.caller_is_project_pm`). Tests: `024_internal_clients_and_projects` (shape, `is_internal_client`, role rename, TM creates internal project + TL denied, AM resolves, PM manages cross-dept sub-tasks + non-PM denied). Verified on PG16.
- [x] `I7.1` (UI) **Internal project creation — DONE (verified 26 Aug), but built as its OWN surface,
  not a Brief Wizard branch.** `/campaigns/internal` (`src/features/internal/InternalProjectPage.tsx`),
  reached from Campaigns by `projects:manage` holders: owner picker (tenant / department / team),
  strategy fields skipped, PM appointed, submit calls `public.create_internal_project`. The original
  wording below ("no new surface") describes a design that was not the one taken. Original note:
  **Internal** brief type in the existing **Brief Wizard** (ADR-0020) — owner picker (tenant/department/team → get-or-create internal client) replaces client selection, strategy fields skipped; submit RPC creates the internal job via `internal_projects:manage`. **No new surface.**
- [x] `I7.2a` (backend) Booking = the assignment record: `bookings` gain `title` (completes the existing `sub_task_id` schema hook) + a subject constraint (`sub_task`/`deliverable`/`job`/`title`, NOT VALID for legacy); `notifications.entity_type += 'booking'`; booking-assignment emission (`app.tg_booking_notify_resource` — notifies the booked resource's user on deliverable/ad-hoc bookings; sub-task bookings ride the sub-task path, no double-notify; human resources only, actor-excluded). Test `025_booking_assignment_notifications`. Verified on PG16.
- [x] `I7.2b` (backend + function) `booking-transition` accepts `subTaskId` + `title` (booking a sub-task or ad-hoc slot); **PM booking authority** — `app.caller_is_booking_pm` branch on the scheduler booking policies lets a PM (holding `bookings:create`) book a cross-department resource for their own project (test `027`). **Needs `supabase functions deploy booking-transition`.** Pure any-role PM booking (pre-check relax) deferred; calendar create-flow UI on device.
- [x] `I7.3` (backend) Reusable SLA profiles per work type: extended the existing `sla_profiles` (turnaround_hours + deadline_rule + is_default + work_type_id + created_by; one-default-per-work-type partial unique); attach points `jobs.sla_profile_id` (project) + `sub_tasks.sla_profile_id` (leaf); `app.effective_sla(sub_task)` six-tier resolver (leaf sla_hours override → leaf → project → work-type-explicit → work-type-default → tenant-default); new `sla_profiles:manage` grant (Department Lead + Team Leader + Power Admin) replacing `organization:manage` on the write policy. Test `031_sla_profiles`. Verified PG16 (full suite re-run: 276 assertions, 0 failures). Additive. Profile-picker UI on projects/tasks deferred to the UI pass.
- [x] `I7.4` (backend) KPIs (manual, individual + team/department rollup): `kpi_definitions` (unit/source/metric_key seam, `aggregation` avg/sum/weighted, bounded `formula` jsonb, `higher_is_better`) + `kpi_targets` (per individual/period; period + per-person-period constraints); scoped `kpi:manage` grant (Department Lead + Team Leader + Power Admin). The app's **first read-restricted table**: `kpi_targets` reads scoped via `app.caller_can_read_kpi` (self / lead-chain team→department / health:view; peers + other tenants denied); writes via `app.caller_can_manage_kpi_target` (lead-in-scope). `app.kpi_rollup(start,end)` computes team (individuals→team) then department (teams→department) aggregates. Test `032_kpis` (20 assertions). Verified PG16 (full suite re-run: 296 assertions, 0 failures). Additive. Self-service *actual* entry + scorecard/rollup UI deferred to the UI pass.
- [ ] `I7.5` KPIs (derived) — P2 seam.
- [x] `I7.5a` (UI) **SLA-at-assignment** — the sub-task assignment form (DeliverablesPage) carries an **SLA-profile picker** (sets `sub_tasks.sla_profile_id`, the leaf tier of the `effective_sla` resolver); the manual **hours** field is the highest-precedence `sla_hours` override; each sub-task row shows the **resolved SLA** (profile · hours / manual override / *Inherited* when it falls back to project/work-type/tenant default). Reads `sla_profiles` tenant-wide (list is readable even though management is Power-Admin-only). No schema change (both columns pre-existed). EN/AR; `DeliverablesPage.test` covers the picker + fallback.
- [ ] `I7.6` **Agency KPI matrix — per-discipline SLA/KPI profile library + KPI-at-assignment (ADR-0032, DEFERRED).** Includes the **KPI-at-assignment** half (a `sub_tasks.kpi_definition_id` link so an assignment references the KPI it feeds — decided 2026-08-19 to defer here, since it depends on the per-discipline default-KPI bundles below and would otherwise add an immutable column the P2 engine may reshape). Seed the concrete metric library from Edward's ad/branding-agency scorecard: per-role KPI definition bundles (Creative / Account / Strategy / Media / Production — each row → a `kpi_definitions` row with a category tag efficiency/quality/business-impact, `aggregation`, `higher_is_better`) + default per-discipline profiles applied when a person's discipline is known, attachable at assignment; team metrics (utilization, project margin, client satisfaction, schedule reliability) extend `app.kpi_rollup`. Usage rules baked in: 3–5 metrics per role, output paired with quality, creative weights first-time-approval/rework, media weights ROAS/CPA/conversion. **Captured design reference only — not scheduled for build; do NOT implement until explicitly scheduled.** Derived-metric computation, external ad-platform ingestion, margin/revenue inputs, and pay/ranking linkage + anti-gaming all stay **P2 (ADR-0024)**. See `docs/adr/0032-agency-kpi-matrix.md`.

### I8 — Task execution & time tracking (ADR-0030, accepted)
- [x] `I8.1` Sub-task Start/Submit lifecycle + single-session timer: `task_time_entries` + `sub_tasks.revision_number`; `app.sub_task_start` / `app.sub_task_submit` (assignee-only; timer path, or submit-without-start → manual minutes flagged `mode='manual'`). Test `026`. Verified PG16. Additive.
- [x] `I8.2` Deliverable approval gate: the transition guard now blocks `→ in_review`/`→ approved` while any sub-task is unsubmitted (`55000`); `app.sub_task_request_changes` reopens a specific sub-task (`revision_number++`), **requires an unresolved review comment** (the change description), sends the deliverable back, and the reopened task holds the gate shut. Test `028`; tests 021/022/023 updated to submit sub-tasks before review. Verified PG16 (incl. re-running 023 end-to-end).
- [x] `I8.3` Soft **dependencies** (`sub_task_dependencies`, cross-deliverable, cycle-guarded) + **external inputs** (`deliverable_pending_inputs`, cascade to sub-tasks) + **started-ahead** capture on Start (`app.sub_task_has_unmet_prereqs`); dropped `blocked` from `sub_tasks.status` (+ frontend `SubTaskStatus`/my-work-buckets). Test `029`. Verified PG16.
- [x] `I8.4` Notifications: sub-task-grain `changes_requested` to the assignee; dependency-satisfied ping to the downstream owner (`app.sub_task_submit` pings downstream owners whose prereqs are now all met; `app.sub_task_request_changes` notifies the reopened task's assignee; new `dependency_ready` notification type + email/i18n copy). Test `030_task_notifications`. Verified PG16. **Needs `supabase functions deploy notify-email`.**

### I9 — Workday attendance (ADR-0031, accepted)
- [x] `I9.1` (backend) Attendance on the SLA spine: `attendance_profiles` (expected check-in / minutes / grace / workdays; tenant default) + `attendance_days` (auto check-in via `app.attendance_heartbeat`, explicit `app.attendance_start_day` override / `app.attendance_end_day`, service-role `app.attendance_nightly_close` inferring a flagged checkout from last activity); `app.attendance_deviation` (late/short/missing/no-checkout, suppressed on non-workdays, holidays, approved leave). Read-restricted (`app.caller_can_read_attendance`: self / team-lead / dept-lead / HR `leave:manage` / `health:view`; peers + other tenants denied); no client write path (RPC-only). **No new grant / no seeder change** (reuses `leave:manage`, `team:view`, `health:view`). Test `033_attendance` (26 assertions). Verified PG16 (full suite: 322 assertions, 0 failures). Additive. **Nightly close needs a scheduler wired at deploy time** (external cron → Edge Function, or `pg_cron`; shared `due_soon` gap). Scorecard/deviation UI + tenant-timezone `late` + per-team profile assignment deferred.

### I10 — A task is a task everywhere (ADR-0034)
Ad-hoc work assigned on the scheduler must be an actionable **task** (lifecycle + notify + "Assigned to me"), not a static booking. A booking stays a static reservation (meeting/hold/leave).
- [x] `I10.1` (backend) Schema enabler: `sub_tasks.deliverable_id` nullable → **standalone tasks** (migration `20260820000000`). Verified safe: assignee-notify trigger + start/submit lifecycle are deliverable-independent; deliverable-state notify + approval gate only target deliverable-backed tasks.
- [x] `I10.2` (backend) **No change needed** — verified `subtask-schedule` is deliverable-independent (passes `deliverable_id` straight through, materialises on the assignee's resource), so inserting a standalone sub-task already materialises its booking + notifies. Reuses the existing sub-task→booking path.
- [x] `I10.3` (frontend) "Assigned to me" (`MyWorkPanel`) — `useMyAssignedWork` left-joins the deliverable (drop `!inner`); `AssignedWorkItem` deliverable fields nullable + `isAdhoc`; standalone tasks render as a non-link item with a sub-task status badge + Start/Submit; `bucketOf` handles a null deliverable state. EN/AR + tests.
- [x] `I10.4` (frontend) Scheduler `BookingDialog` — the **Ad-hoc** path, when the resource is a **person**, creates a standalone task (`deliverableId: null`, assignee = resource's linked user, title/hours/dates → materialises the booking, notifies, lands in My Work); equipment/rooms keep the plain reservation. **Meeting/Reservation deferred to the huddle work** (Edward) — kept to Project + Ad-hoc for now. A field hint explains the assign-a-task behaviour. `SubTaskWriteArgs.deliverableId` nullable. EN/AR.
- [x] `I10.5` **Live verified through the pilot (26 Aug)** — the assign — notify — Start/Submit — review
  — approve cycle has been exercised repeatedly on real users this week; `I12.15` was found that way.
  The optional `BookingDialog` unit test was not written (still no schedule-component harness).
  Original note: Live verify (assign an ad-hoc task to a person → recipient sees it in Assigned-to-me with Start/Submit + is notified in-app/email). Optional `BookingDialog` unit test (no schedule-component test harness today).

### I11 — Ad-hoc work is a reviewable deliverable (ADR-0035)
Live testing of I10 showed ad-hoc tasks had no upload-on-submit and no reviewer routing (the review stack is deliverable-scoped). Decision (Edward): full deliverable-style review; **the assigner picks the reviewer**.
- [x] `I11.1` (backend) migration `20260820010000`: `deliverables.reviewer_id`; `public.create_adhoc_deliverable(assignee, title, hours, starts_at, due_at, reviewer)` RPC (get-or-creates the tenant "Ad-hoc" internal job → deliverable + sub-task; gated `project_tasks:manage` + `in_write_scope`; named reviewer must hold `reviews:moderate`); `tg_subtask_notify_reviewer` (sub-task → review notifies the deliverable's reviewer). **Still needs a pgTAP test + local PG16 verify before it's fully signed off.**
- [x] `I11.2` (frontend) Scheduler **Ad-hoc** path → `useCreateAdhocDeliverable` (calls `create_adhoc_deliverable` then `subtask-schedule`) with a **Reviewer** picker (`useReviewers` lists `reviews:moderate` holders; "Any reviewer" = role-based); **replaces** the standalone-task insert from I10.4. Migration verified on PG16 (RPC + reviewer trigger + full Start→Submit→review lifecycle). Deep-links to `/deliverables` ReviewPanel from My Work. EN/AR.
- [x] `I11.2a` **Team Leaders can review/approve** — grant `reviews:moderate` to `team_lead` (+ `deputy_team_lead` via the clone); migration `20260820020000` (reproduces the seeder + re-seeds all tenants). Verified on PG16 (team_lead + deputy = true, team_member = false). They now appear in the reviewer picker and can sign off.
- [x] `I11.3` Reviewer **"Awaiting my review"** inbox (`AwaitingReviewPanel` on My Work home; `useAwaitingMyReview` — sub-tasks in `review` whose `deliverables.reviewer_id` is me) opening the full ReviewPanel inline with **Approve** / **Request changes** — reaches campaign-less ad-hoc deliverables the `/deliverables` page can't. Assignee's **Submit** modal embeds the full ReviewPanel (upload + drag-drop + feedback). Fixed three ambiguous PostgREST embeds that silently emptied results (`media_records`→user_profiles has 2 FKs → name `!media_records_uploaded_by_fkey`; `sub_tasks`→user_profiles has 2 FKs → name `!sub_tasks_assignee_id_fkey`), and made panels surface query errors instead of blank states. Notification links (email `notify-email` + in-app `NotificationInbox`) route ad-hoc review requests to `/my-work`. B2 bucket CORS configured for browser uploads. Numbered image pins ↔ comments; full-viewport review modal. EN/AR.
- [x] `I11.5` **Maker round-trip** — migration `20260820030000`: `sub_task_request_changes` reopens the sub-task to **`todo`** (was `in_progress`) so the maker Starts a fresh **timed** round then Submits (the old untimed reopen could never be resubmitted). On My Work a sent-back task reads **"Changes requested"**; **reading feedback ("Review feedback" modal) is a separate step from Submit**. Updated pgTAP 028; verified 9/9 on PG16.
- [x] `I11.7` **Editable, informative booking modal** — migration `20260820070000`. The schedule Edit
  modal (`EditBookingDialog`) now shows, for a task-backed booking, **who assigned it & when**, **who last
  modified it & when**, and the **reviewer**; and it edits + **saves** the task's title, assignee
  (reassign), reviewer and dates/hours. Backend: `sub_tasks.updated_by` (+ stamp trigger — the
  `audit_events` log is admin-only, so a queryable column is needed; **permanent**); SECURITY DEFINER RPC
  `public.update_task_assignment(...)` (title/assignee/reviewer/dates/hours; only renames **ad-hoc**
  (stream-less) deliverables; keeps **no-self-review**; resets `schedule_overridden` so `subtask-schedule`
  re-materialises on reassign/date change). Frontend: `useBookingTaskDetail` (named-FK embeds for
  assignee/creator/modifier + deliverable reviewer), `useUpdateTaskAssignment` (RPC → `subtask-schedule`),
  `useUpdateBookingFields` (plain-reservation title/notes). pgTAP `038`; verified on PG16. EN/AR.
  **Alpha caveat:** the edit RPC is gated grant-only (see `TMP.3`).
- [x] `I11.8` **Submit-for-review reaches the uploader again (regression fix).** `I11.5` split "read
  feedback" from "Submit" and, in doing so, removed the upload step from Submit entirely: `onSubmit`
  fired `sub_task_submit` blind, and the read+upload modal was gated `!!deliverableId && !campaignId`
  — so **campaign** work had no upload affordance on My Work at all, and ad-hoc work only had one
  behind a separate button. Reviewers received empty submissions. Restored: **Submit opens the
  upload + submit modal** (ReviewPanel embedded — feedback, version chain, drag-drop) for anything
  with a deliverable; a standalone task (no deliverable, ADR-0034) still submits directly. The
  read-only "Deliverable / Review feedback" button stays, and is **no longer ad-hoc-only** — campaign
  and ad-hoc run the identical loop. Submit is **shut until this round has its own version**
  (`versions ≥ revision_round + 1`, one upload per round: V1→round 1, V2→round 2), so round 1's file
  cannot be resubmitted for round 2. EN/AR (`myWork.submit.noneAttached` reworded,
  `noneThisRound` added, the old "you can submit without attaching" hint deleted). Typecheck + 70
  deliverables tests + lint green. **Frontend only — no migration. Uncommitted (Edward).**
- [x] `I12.0` **My Work rebuilt as a task dashboard (Edward, 24 Aug) + review pass.** `/my-work` is no
  longer a bookings list: the date-range table and the Tier-1 "Your Load" card are gone, replaced by
  an attendance + exceptions header row and three panels — **Tasks for today** / **Upcoming tasks** /
  **Completed** — each row carrying its own actions. `ExceptionsPanel` (new) counts Assigned ·
  Overdue · Due today · In review · Not started. `/deliverables` gains a Campaigns/Ad-hoc tab pair,
  the Ad-hoc tab being a **read-only approved archive** (`useApprovedAdhocDeliverables`, `ReviewPanel
  isReadOnly` — no upload, no comments, download only); `review-media` now returns a separate
  `viewUrl` and a `Content-Disposition: attachment` `downloadUrl`. Review pass corrections:
  six i18n keys used with inline English fallbacks and five hardcoded strings in `ExceptionsPanel`
  now exist in **both** locales (EN + AR verified at parity, 1080 keys each); `attendance.endDay`
  re-aligned after an EN-only edit; "today" was computed as `toISOString().slice(0,10)` — **UTC** — in
  three places independently, now one `lib/my-work.ts` (viewer-local, unit-tested) which also owns
  `isFinished`/`openWork` so the counts and the lists cannot diverge; **overdue work moved into
  Today** (it was falling into "Upcoming", below everything not yet urgent); the per-row
  `useDeliverableVersions` call (one request per task on screen) replaced by deriving the version
  from the revision round; `useAdhocDeliverables` renamed to say what it returns (it hard-filters to
  approved); inline `style={{…}}` moved to `index.css`; dead `lib/my-work-buckets` (+ its test)
  deleted — the three-bucket triage it implemented was replaced by the new panels, and it had been
  edited while already orphaned. 258 tests green; typecheck + lint + `check:authz` clean.
- [x] `I12.1` ⚙️ **Task approval (ADR-0038, accepted) — code done, needs `db push` (Edward).**
  Migration `20260824140000`. `public.sub_task_approve` moves a task `review → done` — **the state
  nothing in the system could previously reach**, which is why "who finished this, and when?" had no
  answer — stamping `approved_by` / `approved_at`, authorised by the task's OWN reviewer (checked in
  the DB), notifying the maker (`signed_off`). `sub_tasks.reviewer_id` seeded from the parent
  deliverable by trigger (ADR d.2) and required by `chk_sub_tasks_reviewer_required` — scoped to
  *assigned, non-cancelled* tasks, exactly as the ADR words it, so cancelled history is not falsified
  and an unassigned task needs nobody yet. No-self-review is now a table constraint, not just an RPC
  check. The deliverable gate tightens from *all tasks submitted* to *all tasks APPROVED*. Both
  task-writing RPCs carry the reviewer onto the task, `create_adhoc_deliverable` and
  `update_task_assignment` now **require** one (the latter also verifies they can moderate — it
  previously accepted NULL and silently overwrote a good reviewer on any unseeded edit). Frontend:
  the reviewer inbox keys on the **task's** reviewer and no longer filters on
  `deliverables.state = 'in_review'` — the filter that made campaign work reach nobody — so campaign
  and ad-hoc share one loop; Approve calls the new RPC; "Any reviewer (role-based)" is gone from both
  dialogs (it stored NULL while implying a fallback removed on 23 Aug); a reviewer picker added to
  the Deliverables sub-task form, which had none; Save is held until the edit dialog has loaded, closing
  the silent-wipe path. pgTAP `045` (14). 19 existing test fixtures updated: their deliverables now
  name a reviewer, which the tasks inherit.
- [x] `I12.2` ⚙️ **The task owns its dates (ADR-0039, accepted) — code done, needs `db push`
  (Edward).** Migration `20260824130000`: `app.sync_subtask_span` + a trigger on `bookings` making a
  task's span the **envelope of its live bookings** (earliest start → latest end). Postgres owns the
  invariant, so the drag, the edit modal, the materialiser and any future path all keep it — a
  caller-side version is how the drift arose. Chips move **independently** (Edward's decision over
  the author's block-move recommendation): work Mon/Wed/Fri and the due date is Friday, gap and all.
  Cancelled bookings are excluded; a task with no live bookings keeps its dates, because unscheduled
  is not undated. Backfills existing tasks that have been drifting since the drag was written.
  `schedule_overridden` **survives** with a clearer meaning — it is what protects a hand-arranged
  week from the materialiser's even spread — correcting the author's claim that this ADR retired it.
  Frontend: a cross-resource drag now **confirms** first (it reassigns the work, notifies, and
  discards the arrangement). pgTAP `046` (8).
- [x] `I12.3` **A failed schedule no longer reads as a failure (partial success).** Root cause was
  narrower than "the create isn't atomic": `create_adhoc_deliverable` commits the task, then
  `subtask-schedule` runs as a SECOND call, and `BookingDialog` rendered that second failure with a
  plain `setError` — form still live, submit still enabled. The operator saw what looked like a
  failure and pressed again, and again: **six identical tasks for one piece of work on 23 Aug**, none
  scheduled. Now a scheduling failure holds the created task's id, closes submit, and offers **Retry
  scheduling**, which re-runs `subtask-schedule` against THAT task (`useRescheduleTask`) — pressing it
  repeatedly cannot create anything. EN/AR. **The open half is retired by `I12.5`/ADR-0040**: surfacing an
  unscheduled task was a plaster — the assignment itself half-succeeded. It can no longer occur.
- [x] `I12.7` ⚙️ **Cancelling a task, and the standalone task retired — needs `db push`.** Migration
  `20260824180000`. **Nothing in the app could cancel a task**: you could cancel its BOOKING, which
  left the work alive, assigned, due and off every calendar — exactly the state the three tasks
  cleaned up on 24 Aug were in. Every cancellation until now was a hand-written UPDATE. New
  `public.sub_task_cancel`: status → cancelled, **its bookings released** so cancelled work stops
  consuming capacity, the assignee notified (new `cancelled` notification type), same authority as
  assigning it, idempotent, and refused on an approved task. **Soft on purpose** — the row survives
  for the record; it leaves every working list, which is what "removed" means from the user's side.
  It also replaces the Deliverables page's hard DELETE, which destroyed the task outright including
  any trace it had been assigned and worked on. Reachable from the schedule edit modal (task-backed
  bookings now offer **Cancel task** rather than Cancel booking) and the Deliverables breakdown.
  **Standalone tasks retired:** `sub_tasks.deliverable_id` is NOT NULL again. ADR-0034 made it
  nullable; ADR-0035 superseded that for anything reviewable; nothing has created one since, the
  tenant holds zero, and `media_records.deliverable_id` is NOT NULL so such a task could never hold a
  version — reviewable in name only. The migration refuses rather than deleting anybody's work if one
  is found. EN/AR.
- [x] `I12.6` 🔒 **Role grant corrections (Edward's decisions, 24 Aug) — needs `db push`.** Migration
  `20260824170000`, the three questions `L6.9` surfaced, answered — both halves (the seeder, so new
  tenants are born correct, AND the live rows, since a seeder edit alone changes nothing for a tenant
  that already exists). `account_manager` gains `bookings:create` + `bookings:update` — it assigns
  work, so it must be able to schedule it; **this ships with ADR-0040 deliberately**, which turns its
  previously silent half-assignments into outright refusals. `team_lead` (and `deputy_team_lead`, by
  the clone) gains `bookings:delete`, so a lead can cancel what they scheduled instead of needing
  somebody else. `team_member` gains `schedule:view` — read-only; no booking grants. Deliberately not
  granted: `bookings:delete` to `account_manager` — cancelling somebody's booking is a different act
  from scheduling one, and nobody asked for it.
- [x] `I12.5` ⚙️ 🔒 **Assigning work requires the authority to schedule it (ADR-0040) — code done,
  needs `db push` (Edward).** Migration `20260824160000`. Assignment was gated TWICE with a commit in
  between: `create_adhoc_deliverable` on `project_tasks:manage` + department/team scope, and
  `subtask-schedule` on `bookings:create` + the resource's scope — independent permissions over
  independent objects, so passing the first and failing the second left a **real, owed, invisible**
  task, and every retry committed another (six on 23 Aug). `I12.3` stopped the retry loop; this stops
  the half-success. A `before insert or update of assignee_id` trigger on `sub_tasks` asks both
  questions before anything is written, so it covers the ad-hoc RPC, the campaign form's direct
  insert, `update_task_assignment` and anything added later — gating one RPC is how the split arose.
  Exempt: an assignee with no active bookable resource (nothing to materialise), unassignment, and
  contexts with no `auth.uid()` (seeders/migrations, as RLS already treats them). pgTAP `048` (8),
  including that **no task survives** a refusal. **This retires the open half of `I12.3`** — a task
  cannot reach the assigned-but-unscheduled state, so there is nothing left to surface.
  **⚠️ Edward: this will refuse an assignment that "worked" yesterday.** `account_manager` holds
  `project_tasks:manage` but not `bookings:create` (`L6.9`), so its assignments have always
  half-succeeded; they are now refused honestly and immediately. The fix is a grant, not code — the
  `L6.9` role question, forced.
- [x] `I12.4` **~~No record of who removed a booking.~~ WITHDRAWN — the claim was false (24 Aug).**
  `bookings` has carried the universal `audit_row_change` trigger since `20260802103000`, which fires
  on insert, update AND delete and writes `audit_events` with `actor_user_id`, the operation, the row
  id and (on update) the changed fields. It has never been dropped. The accidental cancel on 24 Aug
  was recorded all along. The finding was asserted from "reschedule writes an audit event and I saw
  no bespoke delete trigger" without checking whether a universal one already covered the table —
  the exact failure mode [[verify-coverage-claims]] exists to prevent, recorded here rather than
  quietly deleted.
- [x] `I11.9` ⚙️ **A submission must have something to review (Option B) — code done, needs `db push`.**
  Migration `20260824150000`. `app.sub_task_submit` checked assignee, status and timer but never that
  a file existed, so an empty round could reach a reviewer; `I12.0` taught the screen to refuse it,
  which is not a rule. **Option B chosen over counting:** `media_records.round` is stamped at upload
  from the parent deliverable's `revision_round` (1-based, mirroring `review_feedback.round`, never
  client-writable), and submit requires a version for THIS round. Counting would let two uploads in
  round 1 silently satisfy round 2. Existing versions back-filled by ordering `version` within each
  deliverable — exact for the one-upload-per-round history. A task with no deliverable is exempt
  (`media_records.deliverable_id` is NOT NULL, so it cannot hold a version; nothing has created one
  since ADR-0035 and the tenant holds zero). Frontend asks the same question the DB does — the round,
  not the count. pgTAP `047` (9), whose last four assertions a counting implementation would fail.
- [x] `I12.8` **The schedule's write-scope mirror, finished (25 Aug).** The grid mirrored the server's
  booking-write authority in one inlined helper pinned to a single permission, `bookings:create`, and
  the **edit modal mirrored nothing at all** — it opened for anyone who could SEE a booking, so an
  out-of-scope user filled the whole form and only learned they were not permitted when Save came back
  `42501`. Two consequences of the same shortcut: dragging a chip is an UPDATE but borrowed the create
  check, and `bookings:update` / `bookings:delete` were never asked about anywhere. Extracted to
  `src/features/schedule/lib/write-scope.ts` (pure `resourceInWriteScope` + `isPmBypassEligible`, 11
  unit tests) behind `hooks/use-write-scope.ts`, which asks **both** axes for a named action.
  `DayGrid`: "+" → `create`, drop → `update`, and a chip is only `draggable` on a row the viewer may
  update. `EditBookingDialog`: Save and the destructive action carry a stated reason when refused, and
  are disabled. **Only what can be mirrored faithfully is mirrored** — a task edit's own gate is
  `project_tasks:manage` + write scope over the *task's* placement and its deliverable's account
  manager, and that placement is not resolvable client-side, so the permission half is mirrored and the
  rest left to the server (the existing `42501` branches stay). Reassignment mirrors ADR-0040's trigger
  exactly (`bookings:create` + scope over the new assignee's resource, no PM branch); `bookings_scheduler_delete`
  likewise has no PM branch, so cancel mirrors exactly; a **project-linked** booking leans ALLOW because
  ADR-0029's PM bypass is not knowable here. Two lean-ALLOW asymmetries are documented and tested. Also
  recorded: `resource_in_write_scope` passes NULL for the account manager, so `scope='account'` reaches
  a resource **only** through an explicit `user_scope_grants` target — not through the accounts it owns
  (worth knowing after `I12.6` gave that role its booking grants). No ADR: this changes no rule, it
  makes the client tell the truth about rules the database already enforces. Five EN+AR keys added
  (parity checked). Stale comment at `schedule-api.ts` corrected — it still described the `TMP.1`
  alpha grant-only policy that `20260823110000` withdrew. Typecheck + lint + 270 unit tests green.
  **Frontend only — no migration.**
- [x] `I12.9` **Refusals tell the truth, and writes look like they are working (Edward, 25 Aug — pre-UAT).**
  Three findings from Edward ahead of the end-to-end session. (a) **The refusal was wrong.** The grid
  answered every blocked "+" with one hardcoded sentence — "You can only book resources on your own
  team" — shown to everybody. It was wrong for most of them: a Team Member can only book themselves,
  a Department Lead reaches a department, and someone lacking `bookings:create` has no team problem
  at all. A wrong reason is worse than none: people go and ask for the wrong thing. Now
  `bookingRefusal()` (pure, 7 tests) picks the first reason the person can act on — missing
  permission → **unplaced resource** (no department AND no team, which no scope grant can reach, so
  the fix is to place the resource, not widen the person) → their actual reach, `account` included
  (which reaches no calendar at all). The edit modal uses the same vocabulary, so the two can't
  disagree. (b) **It appeared as a strip above the grid**; it is now a centred `alertdialog` — a
  refusal is a decision about that person, not a page status line. `schedule.notAuthorisedBook` is
  deleted. (c) **Every write was silent** — the button disabled itself, nothing else happened, and a
  slow save was indistinguishable from a dead click. New `src/components/BusyButton.tsx` (spinner +
  `aria-busy` + press-blocking) and `BusyNote` for actions with no button of their own; applied to
  booking create/retry, edit save, cancel task, cancel booking, the reassign confirm, **the drag**
  (which had no feedback whatsoever — the chip doesn't move until the server agrees), My Work
  start/submit ×3, review approve / request-changes / add-comment, and the ADR-0041 reach confirm.
  `prefers-reduced-motion` respected. Also fixed while checking: the `L6.12` holder-count line used
  `holders` + `holders_other`, which i18next renders as the singular for every count — corrected to
  `_one`/`_other` and pinned by a test. 21 EN+AR keys (parity checked). Typecheck + lint + 291 tests
  green. **Frontend only — no migration.**
- [x] `I12.10` **Three UAT blockers on /schedule (Edward, 25 Aug).** (a) **The grid refused before it
  knew.** `canWriteResource` called `can()`, which is fail-closed and answers false until the grant
  fetch lands — right for deciding whether to RUN something, wrong for deciding whether to OFFER it.
  Every button was dead on arrival and any later re-render (Edward found it by toggling EN↔AR) fixed
  it. Gates now lean ALLOW while `!ready`; the server still refuses anything genuinely not
  permitted. (b) **A failed grant fetch was indistinguishable from holding nothing** — `can()` false,
  every button dead, no explanation, and the honest answer is "reload", not "ask an admin". The
  permissions context now exposes `failed` and `/schedule` says so. This is the most likely cause of
  (a) surviving past load: a transient RPC failure retries silently, so it starts working seconds
  later and the retry gets credited to whatever the user last clicked. (c) **Save was live for a
  Team Member editing a task.** The mirror checked `project_tasks:manage` only — which
  `team_member` HOLDS from the seeder — while the server also tests
  `app.in_write_scope(task.department_id, task.team_id, <deliverable's AM>)`. `useBookingTaskDetail`
  now fetches the task's placement and the modal mirrors it; the AM half stays unresolvable
  client-side, so an account-scoped caller leans ALLOW. 2 EN+AR keys. 292 tests green.
  **Frontend only — no migration.**
- [x] `I12.11` **No self-booking for team members — DECIDED, keep as-is (Edward, 25 Aug).** Raised as
  a possible defect: `app.in_write_scope` returns false for scope `self` on the stated grounds that
  "'self' is handled by explicit owner predicates" (`20260812120100`), but **no bookings policy
  carries one** — all three are `has_permission AND (resource_in_write_scope OR
  caller_is_booking_pm)`, verified across every migration that has touched them. So a Team Member
  holding `bookings:create` cannot block out even their own time. **Edward's decision: that stays.**
  Someone who needs time booked asks a team leader; scheduling authority belongs to the people who
  can see the whole picture, and the alternative (a per-user department scope grant) would hand them
  everyone else's calendar to solve a smaller problem. No owner predicate will be added. **No ADR:
  this changes nothing — it declines a change.** Consequences carried out: the `self` refusal message
  no longer offers self-booking as the consolation (it said "You can only book your own calendar",
  which was untrue for exactly the person reading it) and now points at the team leader; the
  decision is recorded beside the branch in `lib/write-scope.ts` and pinned by tests named
  *(deliberate)*, so nobody re-opens it as a bug. Pre-existing since the `L6.5` revert; visible only
  once `I12.6` gave `team_member` `schedule:view`.
- [x] `I12.12` **The Ad-hoc deliverables table says what that tab is actually for (Edward, 25 Aug).**
  The tab is an approved-only archive, but it carried the campaign tab's columns. (a) **Discipline
  dropped** — it comes from the stream, and `useApprovedAdhocDeliverables` hardcodes it null, so it
  was a column of dashes by construction. Kept on the campaign tab, where it carries a work type.
  (b) **Revision round → approved version.** The round is the wrong number here; what matters is
  which version was signed off. The versions come back on the existing list query as a
  `media_records(version)` embed (one FK, so no ambiguity — the three-FK footgun is
  `sub_tasks`→`user_profiles`), max per deliverable, no N+1. Renders `v3`, or `—` when nothing was
  uploaded. (c) **Archive.** The Actions cell was hardcoded `tab === 'campaign'`, so the ad-hoc tab
  rendered **no actions at all** and approved work could never be tidied away. Nothing new was
  needed server-side: `approved → archived` is already in the transition graph and the DB guard,
  `actionKey` already maps it, and the label already existed — the tab simply never offered them.
  Filtered to **Archive only**: "Mark delivered" and "Reopen" are campaign-lifecycle moves, and
  delivery files into a campaign Library folder ad-hoc work does not have (`I11.4`). Transition
  buttons also picked up the `I12.9` spinner, and the tab switcher gained `aria-pressed` + testids.
  1 EN+AR key. 5 new tests. 299 green. **Frontend only — no migration.**
- [x] `I12.13` **The cross-resource drag now actually reassigns (ADR-0039 d.6) — audit finding.**
  The confirm dialog has always promised three things: the work changes hands, the new assignee is
  notified, their schedule is rebuilt. **None happened.** The confirm button called `applyMove` →
  `booking-transition` reschedule, whose only writes are the booking's dates and `resource_id`.
  `sub_tasks.assignee_id` never moved, so the task stayed in the ORIGINAL person's queue and Start/
  Submit path, the new person was never told (`tg_booking_notify_resource` deliberately returns early
  for task-backed rows, deferring to the `assignee_id` trigger that never fired), and **ADR-0040's
  assignment-authority trigger was bypassed entirely** because the column it watches never changed.
  Fixed by routing the confirmed drag through `public.update_task_assignment` — the same
  authoritative RPC the edit modal uses — carrying the task's own title/reviewer/hours unchanged.
  **The drop day moves the dates too**: the task starts on the day it was dropped and keeps its span
  length, computed in the target resource's office timezone. A first cut sent null dates and lost
  that; dragging days is a stated requirement that has always worked on the same-resource path (the
  booking write syncs the task's span through ADR-0039's envelope trigger) and a cross-resource drag
  must not silently cost it. Reassigning resets `schedule_overridden`, so `subtask-schedule` releases
  the old bookings and re-materialises on the new calendar at the new dates. Refuses with a stated
  reason when the target resource has no linked user. **No defensive branch for a missing reviewer:**
  `chk_sub_tasks_reviewer_required` guarantees an assigned task has one and only an assigned task has
  a chip to drag, so it is unreachable by construction. 1 EN+AR key. **Frontend only — no migration.**
- [x] `I12.14` **The schedule read a task's reviewer from the wrong row (ADR-0038) — audit finding.**
  `useBookingTaskDetail` mapped `reviewerId`/`reviewerName` from the embedded **deliverable**, not
  from `sub_tasks.reviewer_id` which ADR-0038 d.2/d.3 made the source of truth. For campaign work
  `deliverables.reviewer_id` is always null, so the edit modal showed the retired "Any reviewer
  (role-based)" label and blanked the select; where a deliverable named a *different* person, saving
  any unrelated edit silently reassigned the task's reviewer through `update_task_assignment` — an
  authority change nobody made. Now selects `reviewer_id` plus a `sub_tasks_reviewer_id_fkey` embed
  (named because `sub_tasks`→`user_profiles` has six FKs; name verified against the generated types)
  and maps from the task. The unused deliverable-reviewer embed is dropped, and the retired
  `schedule.reviewerAny` key is deleted from both locales — a blank reviewer now renders as an
  em dash, which means "unassigned", not "any reviewer is fine". **Frontend only — no migration.**
- [x] `L6.13` ⚙️ 🔒 **Team Member holds no task management, and the grant I dropped is restored —
  needs `db push` (Edward).** Migration `20260825110000`. **(a)** `project_tasks:manage` has been in
  Team Member's seed list since the first RBAC migration (`20260802100000`), where the entire
  rationale reads `-- Team Member.` Nothing they do needs it — verified each path: `sub_task_start`
  and `sub_task_submit` both gate on `assignee_id = auth.uid()`; `sub_tasks_manage_update` carries an
  explicit `or assignee_id = auth.uid()` branch whose own comment says *"Team Member has no manage
  path here, but may progress a sub_task assigned to them"*; uploads are `media:manage`; the queue is
  `my_tasks:view`. What it bought them was the `/deliverables` + `/pipeline` nav entries and the
  Deliverables screen's management controls — every write behind which RLS refused anyway, since a
  `self`-scoped caller reaches no task. A menu item and buttons that cannot work. **(b)** Restores
  `('account_manager','manage')`, which `20260824170000` lost when it reproduced the 130-line seeder
  from the older `20260823110000` base — a diff of the two bodies confirms it is the **only**
  unintended loss. The existing tenant was unaffected (its row was written directly by
  `20260823140000`); every tenant seeded since would have got an Account Manager who cannot be named
  as a client's AM. Found by the 25 Aug audit, verified independently before fixing. **(c)** Adds the
  ADR-0033 `search_path` pin the live seeder lacked — `CREATE OR REPLACE` without a `SET` resets
  `proconfig` and drops the pin the `20260819250000` sweep applied. Per-user overlay grants
  (`user_grants`) are deliberately untouched: an individual given task management keeps it.
  pgTAP `050` (6) asserts against a **freshly seeded tenant**, not the fixture — `helpers/seed.sql`
  now re-adds `project_tasks:manage` to a003 on purpose, because several suites exist to prove the
  permission alone is not enough and scope is, and they would otherwise start passing for the wrong
  reason. Stale "from its role" comments corrected in `017`, `038`, `039`, `041`.
- [x] `I12.15` ⚙️ 🔒 **REGRESSION: approving a task never signed off the ad-hoc deliverable — needs
  `db push` (Edward).** Migration `20260825120000`. Found in live use during the review/approve
  run-through: the reviewer approves, the task goes to `done`, and the deliverable stays `in_review`
  forever — so it never reaches the `/deliverables` Ad-hoc tab, which lists `state = 'approved'`.
  **Cause, and it is mine.** ADR-0038 moved approval to the TASK; on 24 Aug `AwaitingReviewPanel` was
  changed to call `sub_task_approve` instead of transitioning the deliverable — correct, because the
  old version required the deliverable to be `in_review`, a state only ad-hoc work ever reached, so
  campaign tasks arrived with Approve permanently greyed out. **The other half was never put back.**
  Nothing else advances a deliverable: every automatic write to `deliverables.state` in the whole
  migration history moves it *backwards* to `in_progress` (request-changes). The panel's own header
  comment still described the old behaviour, which is how it read as done. **Fix** mirrors the submit
  side, where `MyWorkPanel` already advances an ad-hoc deliverable `in_progress → in_review` with the
  reasoning written beside it — an ad-hoc deliverable IS its one task; a campaign deliverable holds
  several so one task must never move it. Implemented **inside `sub_task_approve`**, not the panel:
  the submit-side equivalent is a best-effort client call, which is exactly why nobody noticed when
  the approve-side one went missing (AGENTS.md §2). Not swallowed — the transition guard needs
  `reviews:moderate` and ADR-0038 already requires an appointed reviewer to hold it, so a refusal
  means something is wrong and should be seen. **Repairs the stranded work**: ad-hoc deliverables
  still in `in_review` whose tasks are all finished and where at least one carries `approved_by` (the
  reviewer's recorded decision) are moved to `approved`; the guard trigger is disabled for that one
  statement because a migration has no `auth.uid()`, and the count is raised as a NOTICE. Panel
  header comment corrected. pgTAP `051` (7): the regression directly, a campaign deliverable NOT
  moved, and an unapproved sibling holding sign-off shut. **Frontend unchanged** (299 green).
- [x] `L6.14` ⚙️ 🔒 **Everyone internal can upload for review — needs `db push` (Edward).** Migration
  `20260825130000`. Reported from live use: a user saw the review panel with **no upload button**.
  `ReviewPanel` renders the control only for `media:manage` holders (`ReviewPanel.tsx:35`), and the
  seed list gave it to Power Admin, Traffic Manager, Department Lead (clones Traffic Manager) and
  Team Member — but **not** Team Leader, Deputy Team Leader (clones Team Leader), Account Manager or
  the C-suite. So a Team Leader could moderate a review and never put a file into one. Same shape as
  Team Member's `project_tasks:manage`: an omission in the original list, not a decision. Edward's
  call — everyone internal uploads. **Client Portal deliberately excluded** (holds `portal:view` and
  nothing else; external upload is M10 with its own decisions). Seeder reproduced from
  `20260825110000` by **scripted edit + diff**, six single-line additions and nothing else — this
  seeder has already lost a grant to retyping once (`20260825110000` Part 2), so it is not retyped
  again. pgTAP `052` (4) against a freshly seeded tenant: every internal role holds it, the four that
  could not are named explicitly, the portal does not, and the portal's single grant is untouched.
  Checked no suite asserts a role *lacks* it — `018` strips it first, `039` denies it via the overlay.
- [x] `I12.16` **A chip's width is its hours; My Work names the assigner and reviewer (Edward, 25 Aug,
  from live testing).** **(a)** Every chip on `/schedule` rendered at `inline-size: 100%` regardless
  of load, so a 30-minute holding slot looked identical to a full day's work and the only clue was
  the number printed inside it. `lib/chip-width.ts` sizes each chip as a share of the cell —
  100% load = a standard day (8h, `STANDARD_DAY_HOURS`) — with a floor so a short booking stays
  readable and clickable and a ceiling so one over-long booking cannot break the column (going over
  the day is the cell's overload badge's job, which is a better place for it than a broken layout).
  Only load-based resources are scaled: an exclusive room is taken or it is not, and a pool's
  occupancy is a count, not a share of a day — both stay full width, as does any booking carrying no
  `load_pct`. `.chip-wrap` gains `align-self: flex-start` so a narrow chip does not stretch back to
  full width in the flex column. 6 unit tests. Kept in `lib/` rather than the component so the file
  stays exporting components only. **(b)** `/my-work` rows now name **who assigned it** and **who
  reviews it** — both already on the task (`assigned_by` from `20260823130000`, `reviewer_id` from
  ADR-0038), so the assignee no longer has to open a modal to find out who to go back to. Both embeds
  name their FK constraint (`sub_tasks_assigned_by_fkey`, `sub_tasks_reviewer_id_fkey`): `sub_tasks`
  → `user_profiles` has six foreign keys and PostgREST refuses an ambiguous embed outright. 2 EN+AR
  keys. **(c)** **Every chip rendered purple, ad-hoc included, contradicting the legend beside it.**
  `isAdhoc` was `!campaignName && !taskName` — correct until ADR-0035, which gave every ad-hoc task a
  deliverable (the whole point of it, so the review stack has something to hang off). That made
  `taskName` always populated and the test permanently false. Now decided on the CAMPAIGN, which is
  what actually separates them: no booking path sets `campaign_id` for ad-hoc work
  (`subtask-schedule` writes only deliverable_id + sub_task_id; `booking-transition` derives the
  campaign through the deliverable's stream, which job-backed work has none of). **The label had to
  move with it** — the old ad-hoc branch labelled from `notes`, which is usually empty, so flipping
  the classification alone would have blanked every ad-hoc chip; `create_adhoc_deliverable` names the
  deliverable after its task, so `taskName` is the ad-hoc label with `notes` as the plain-reservation
  fallback. Extracted to `lib/chip-kind.ts`, 4 tests including that trap. **(d)** The overload glyph
  was a 13px character in the corner, the same visual weight as the text around it. Now a filled
  badge with a contrasting ring, plus a tint on the whole cell so a loaded day is findable while
  scanning a week — the badge says which, the tint says where to look. Breach pulses three times,
  behind `prefers-reduced-motion`. **Frontend only — no migration.** 309 tests green.
- [x] `I12.17` **The role preview logged you out (Edward, 26 Aug, from live testing) — audit finding.**
  Selecting a previewed role in the Dev panel could drop a signed-in Power Admin on the login form.
  Nothing role-specific about it, and no session was ever lost: **`preview-guard` treated every POST
  as a write**, but PostgREST tunnels `rpc()` through POST and Edge Functions are POST-only, so the
  guard was also refusing the app's *reads*. The one that did the damage is
  `public.my_scope_grants()`, which `permissions.tsx` calls on **every** permission load — preview or
  not. With the guard already armed (i.e. switching from one previewed role to another, or any
  refetch after the first), that call was rejected, the whole grant query errored, and `defaultRoute`
  fell back to its `'/login'` string — which `RequirePermission` and `IndexRedirect` then dutifully
  navigated to. The first preview of a session usually survived only because the guard is armed by a
  parent effect a beat *after* the child query dispatches its fetch. **The fix, in two parts.**
  **(a)** POST is now classified by *what is being called*: `/rest/v1/rpc/<name>` passes only for a
  named read-only function (`my_permissions`, `my_scope_grants`, `users_holding_permission`,
  `effective_sla`, `kpi_rollup`, `attendance_deviation` — each `stable` in its migration, which is the
  rule for adding to the list), any other `/rest/v1/` POST/PATCH/DELETE is a table write and stays
  blocked, and `/functions/v1/` passes only for the signing functions' read op (`asset-url` →
  `download`, `review-media` → `view`, read from the request body) so **library and review media
  render again while previewing** instead of coming up broken. Unrecognised names are blocked: it is
  an allowlist, so the failure mode of a new RPC is a visible refusal, never a silent write.
  **(b)** A failed grant fetch no longer *routes* anywhere. `can()` being false because nothing
  loaded is not the same as holding nothing, so both guards now render `PermissionsUnavailable`
  — "couldn't load your permissions, you are still signed in" with a retry — rather than bouncing to
  `/login`. That kept a plain network blip from reading as a logout too. 5 new guard tests (8 total),
  3 EN+AR keys. **Frontend only — no migration.** 314 tests green.
- [x] `I13.2` **The Deliverables page shows live ad-hoc work, and separates live from finished
  (Edward, 26 Aug, from live testing).** The Ad-hoc tab hard-filtered to `state = 'approved'`
  (`useApprovedAdhocDeliverables`), so it was an archive: work in flight was invisible, and its
  detail view returned a read-only `ReviewPanel` with **no task table** — which meant the `I13.1`
  requirements editor was unreachable for ad-hoc work, the only kind most of the pilot creates.
  **(a)** `useAdhocDeliverables` returns every ad-hoc deliverable; the tab renders **Live** and
  **Completed** as separate tables with counts, because they answer different questions and mixing
  them buries the live ones. The campaign tab keeps one list — it is already narrowed to a
  campaign, and its states are a delivery lifecycle, not a done/not-done axis. **(b)** A LIVE ad-hoc
  deliverable now shows its task's requirements editor and a writable review panel; a finished one
  stays a read-only record, since adding a camera to approved work is meaningless. **(c)** The rule
  **(d)** The detail opens as a **modal**, not inline under the table — on a tab with 51 live
  items you select something near the top and the panel appears past the fold, so it reads as
  "nothing happened" (Edward, 26 Aug). Reuses the repo's `dialog-backdrop` / `dialog-wide`
  pattern, which is already sized for the review panel, so the download list and the
  requirements editor both have room. Applies to **both** tabs. **(c)** The completeness rule
  is one pure function, `lib/completeness.ts` — `delivered` counts as **live** on purpose: it is out
  with the client and a revision can still come back, so filing it under Completed would hide
  exactly the work most likely to return. 4 unit tests + the page suite. **Frontend only.**
### I14 — Client Manager, brief intake, multiple reviewers (Edward, 26 Aug)
> Six changes requested together, plus one they forced. Three are architecture and carry ADRs
> (`I14.1` multiple reviewers, ADR-0043; `I14.3` brief ingestion, ADR-0044; `I14.7` reminders and
> escalation, ADR-0045 — which `I14.1` makes necessary, because mandatory reviewers let a task stall
> on one person). The rest are UI over shape that already exists — recorded here rather than in an
> ADR, because inventing a decision record for "add four options to a radio group" devalues the ones
> that matter. **All three ADRs accepted by Edward on 27 Aug and indexed; nothing here is gated.**
- [x] `I14.1` ⚙️🔒 **A task may have several reviewers, some mandatory — ADR-0043, ACCEPTED
  (Edward, 27 Aug).** New `sub_task_reviewers` join table as the single home (`is_mandatory`, `approved_at`
  per reviewer); `sub_tasks.reviewer_id` backfilled and dropped. **Every mandatory reviewer must
  approve; with none marked mandatory the first approval completes it.** Request-changes by anyone
  clears every approval — an approval belongs to a version. Five call sites move together:
  `sub_task_approve`, `tg_subtask_notify_reviewer`, the "Awaiting my review" query (now per-reviewer,
  not per-task), `update_task_assignment`, and the reviewer picker (multi-select + a mandatory toggle).
  `chk_sub_tasks_reviewer_required` becomes a constraint trigger. **Includes the waiting-on surface
  (ADR-0043 d.8):** a task in review names the reviewers still outstanding, mandatory ones marked,
  wherever it is shown to somebody other than that reviewer. That is not an extra — with one reviewer
  "waiting on review" had one obvious name, and this ADR is what removes that, so it closes the
  ambiguity it creates. No new data: `sub_task_reviewers where approved_at is null`. **Closed 6 Sep** — live and applied since 31 Aug: `sub_task_reviewers` across 13 migrations, `ReviewerPicker`, `src/lib/reviewers/`, pgTAP `056` + `057`. Not yet exercised end to end by real users; that is Part 4 of the acceptance run, not a build item.
- [x] `I14.2` **Client Manager on client registration — NO SCHEMA CHANGE NEEDED.** `clients.
  account_manager_id` and `campaigns.account_manager_id` have existed since `20260812120000` with
  exactly the requested semantics: the client's manager is the default, a campaign may override, and
  `app.deliverable_account_manager` already resolves
  `coalesce(campaign.account_manager_id, client.account_manager_id)`. **The gap is only that the
  client registration form never asks.** Add the picker to `/clients` (eligible users =
  `users_holding_permission('account_manager','manage')`, the allowlisted lookup that already exists)
  and show the inherited value, overridable, on the campaign. **Naming DECIDED (Edward, 26 Aug): "Account
  Manager" everywhere** — the label matches the role key, the permission and every other surface. His
  phrase "Client Manager" describes the same person, and one name is what stops the approve/sign-off
  split happening again.
  **DONE 29–30 Aug, both halves, and the second half was found by the acceptance run rather than by
  this entry.** The client form asks (`ClientForm`, eligible people from
  `users_holding_permission('account_manager','manage')`) and the campaign overrides
  (`create_campaign_from_brief` gained `p_account_manager`, wizard step 1 asks, pre-filled from the
  selected client — `20260829150000`). The override half turned out not to be optional: see
  `I27.1`, where a campaign under a client with no account manager could be approved by nobody.
- [x] `I14.3` 🔒💰 **AI brief ingestion — ADR-0044, ACCEPTED (Edward, 27 Aug).** `.docx` / `.txt` / `.md`
  upload or paste → text extracted **client-side** (`mammoth`, BSD-2-Clause, dynamically imported)
  → new **`ingest-brief` Edge Function** calls **Claude Sonnet 5** with a structured-output schema,
  Zod-validated both ways, the API key as an Edge Function secret (never the browser). **Provider
  and key name superseded by ADR-0049 — see the note at the end of this item.**
  **Edward cleared both gates on 26 Aug** — the paid dependency (ADR-0002 authorization: this is the
  project's first) and OD 30 residency **for briefs only**, on the basis that a brief carries no
  commercial data. OD 30 stays open for rates, costs, contracts and media. The model has **no tools
  and no data access**, so a hostile document can only put odd text in a field a person is about to
  read. Fills empty fields only, each marked "from the uploaded brief"; a heading-matching fallback
  in `src/lib/brief/` covers a failed call. Source document files into the campaign's References
  folder, closing parked `L1.5` follow-up (b). **Input capped at 50,000 characters — refused, not
  truncated** (a brief cut in half fills fields from the surviving half and looks complete). No
  per-tenant quota or monthly ceiling in v1, deliberately. **Licence gate cleared — ADR-0047
  (Edward, 27 Aug):** `mammoth` itself is BSD-2-Clause and always passed; three of its transitive
  deps did not (`duck`, `jszip`, `pako`). `Zlib` allowlisted, MIT elected for `jszip`, `duck` pinned
  at `0.1.12`. `npm run check:licenses` now passes with `mammoth` installed (verified against the
  Lane B worktree, 192 packages).
  **PROVIDER SWITCHED — ADR-0049 (Edward, 27 Aug):** now **OpenAI Responses API**, default
  **`gpt-5.6-luna`**, secret **`OPENAI_API_KEY`**. A *billing* decision — the Anthropic account could
  not be funded — not a technical one. One file changed (`handler.ts`); the output schema needed
  none, since it was already strict-mode shaped. **ADR-0044 d.6 is re-opened:** confirm OpenAI's
  no-training default is not opted out, and decide whether zero retention is needed, BEFORE
  enabling in production. Neither is enforced by code. **Closed 6 Sep** — deployed and running on OpenAI (ADR-0049). The one thing still outstanding is ADR-0044 d.6’s residency/no-training acceptance against the OpenAI account, which is a decision for Edward and not code.

- [x] `I14.4` ~~**Brief types: remove Feedback/Revision, add four.**~~ **SUPERSEDED by ADR-0048 d.1
  (Edward, 27 Aug)** — folded into `I16.2`. The original wording was written before
  the agency brief-template deck (client-supplied, not included in this repository) was read; the deck turned out to be the source of the
  existing list, and `single_execution` has to leave alongside `feedback` (both are already built
  features: ADR-0030 request-changes and ADR-0035 ad-hoc work). Kept here, struck through, so the
  change of scope is visible rather than silent. Original text:** Drop `feedback` from `BRIEF_TYPES`;
  add `creative_strategy`, `communications_strategy`, `brand_guidelines`, `custom`. EN+AR keys.
  `briefType` is stored inside `campaigns.brief jsonb`, so this is a frontend list plus locale — no
  migration. **Check first** whether any live campaign carries `briefType: 'feedback'`: the value
  would still render, but its label key would vanish and it would show as a raw key, which is the
  `notifications.type.cancelled` bug repeated. Keep the locale key if any row uses it. **Closed 6 Sep:** superseded, nothing to build.
- [ ] `I14.5` **Step 1 of the wizard is mandatory in full — MOSTLY DONE, reworded 6 Sep.** The
  original entry read *"today Next is always live and step 1 has no validation at all"*, and that
  has not been true since `I40.8`: `stepValid(1)` gates Next on client, campaign name and account
  manager (ADR-0073 d.5 made the last of those required, because they are the intended approver).
  **Two of the four fields it named have changed underneath it.** *Brief type* cannot be required —
  ADR-0050 d.5 removed the campaign-level brief type entirely, and a brief type is now a property of
  a DEPARTMENT's brief. *Brand* is deliberately optional: a client may have none, and step 1 files
  brand documents only once one is chosen (`I35.2`). **What is genuinely left** is the smaller half:
  per-field messages on blur rather than a disabled Next that does not say which field it is waiting
  for.
- [x] `I14.6` **Reference-document upload — BUILT, on step 2 rather than step 1 (closed 6 Sep).**
  `DocumentFiling` files into the campaign's own folder tree, References among them, through the
  `asset-url` path (ADR-0022) and sharing its upload code with `I14.3` exactly as this entry asked.
  **Two things the original wording got overtaken by.** The step: brand documents file on step 1
  because they hang off the BRAND, and campaign references file on step 2 because they hang off the
  campaign. And the staging problem it describes is gone — ADR-0067 creates the campaign as a
  `draft` on leaving step 1, so there is a folder to file into and nothing has to be held back until
  submit. **If Edward wants campaign references collectable on step 1 as well, that is a new item,
  not this one.**
- [ ] `I14.7` ⚙️ **Work that stalls is chased, then escalated — ADR-0045, ACCEPTED (Edward, 27 Aug).** New
  `supabase/functions/stall-sweep/` on exactly the `archive-sweep` pattern: cron-invoked,
  `CRON_SECRET` header, service-role, no user JWT, idempotent by construction. **Two rungs, set by
  the tenant:** remind the outstanding reviewers at `review_reminder_hours` (default **24**),
  escalate at `review_escalation_hours` (default **48**) to the assigner and the account manager —
  the ADR-0042 d.6 pair — **plus the reviewer again**, so nobody is escalated behind their back.
  Thresholds are **working hours on the reviewer's office calendar** (ADR-0005), not wall-clock.
  **Both are edited in the UI, not in a migration (ADR-0045 d.3, Edward 27 Aug):** a new typed
  `tenant_reminder_settings` row on the existing `tenant_storage_settings` shape, and a new
  **Admin → Reminders** screen behind `organization:manage` with three fields (remind after,
  escalate after, due-soon warning), each stated in working hours, escalation refused if not greater
  than remind. No row = defaults. **This is the project's first tenant-settings screen** —
  `tenant_storage_settings` has had none since ADR-0023 — so budget for it as real work. `reminded_at` /
  `escalated_at` on `sub_task_reviewers`, cleared by request-changes exactly as approvals are, so
  each round chases afresh. A reviewer who has approved is never chased: the unit is the outstanding
  *approval*, not the task. **Also closes the `I5.1` deferral** — the same sweep emits `due_soon`,
  a valid notification type nothing has ever emitted. Reminders are in-app only; escalations also
  email (ADR-0028). Two new types, `review_overdue` and `review_escalated`. Nothing is auto-resolved.
  **Depends on `I14.1`** for `sub_task_reviewers` — it hangs `reminded_at`/`escalated_at` off that
  table, so it cannot start until `I14.1` has landed its migration.

- [ ] `I11.4` **Library filing is built but wired to nothing (corrected 25 Aug — the old wording was
  wrong).** *Previously written as "ad-hoc approved output has no Library home", which read as though
  ad-hoc work went unstored. It does not, and the ad-hoc angle is incidental. Corrected after
  checking every caller rather than trusting the note.* **What is true:** review uploads — ad-hoc and
  campaign alike, one identical path — are stored as `media_records` rows on the deliverable with the
  bytes in B2 under a tenant/deliverable key, retrieved through `asset-url`'s short-TTL signed links.
  **Approval changes status and touches no file**, so an approved ad-hoc version sits permanently on
  its deliverable's version chain. That is exactly what Edward agreed: uploads are stored, they are
  simply not copied into the client Library. Nothing is unstored and nothing errors today.
  **The actual gap:** `deliver_deliverable_version` / `promote_delivered_version_to_final`
  (`20260817100000`) are the ONLY things that ever write into the Library, and **nothing calls
  either** — not a screen, not an Edge Function, not a trigger, not another function (verified across
  `src/`, `supabase/functions/` and every migration; the sole reference outside their own definition
  is the generated types file). So approval files nothing into the Library **for anyone**, campaign
  work included. This is an unfinished feature, not a hole. **If it is ever wired up**, the campaign
  lookup (`coalesce(stream.campaign_id, job.campaign_id)`) is null for ad-hoc work and raises "no
  campaign to file under" — which is the only reason ad-hoc appeared in this entry at all. The
  decision that would then be needed: give the "Ad-hoc" internal job its own Library folder tree, or
  file ad-hoc finals under a tenant "Ad-hoc / Unplanned" folder. **Not required for UAT.**

### I13 — Sub-task resources: the assets a task needs (ADR-0042, accepted)
> A booking is a booking **of** a resource; this is the other direction — the resources a task
> **needs**. Today the requirement is expressible only as a side effect of a calendar entry, and
> `subtask-schedule` deletes it on every reassignment, date change or hours change. Every resource
> has its own id (Camera A ≠ Camera B); a required resource may be a **person**. A clash **raises,
> never blocks and never moves a date** — assignment always succeeds and a human decides.
- [x] `I13.1` ⚙️ 🔒 **`sub_task_resources` + the scheduler and span changes (ADR-0042).**
  **(a) and (b) written 26 Aug — migration `20260826100000`, needs `db push` (Edward) and the CI
  pgTAP run (no Docker on this machine, so the suite has not been executed locally).** The table
  carries composite `(tenant_id, sub_task_id)` / `(tenant_id, resource_id)` foreign keys rather
  than plain ones, so a requirement cannot point at another tenant's camera whoever writes it —
  which needed a `unique (tenant_id, id)` on `sub_tasks` and `resources` to reference. Writes go
  through a new `app.can_manage_sub_task` (SECURITY INVOKER — it reads only what the caller can
  already select), which mirrors the `sub_tasks` manage policies minus their `assignee_id =
  auth.uid()` branch: that branch is a progress path, and deciding a task needs the camera is
  management. pgTAP `053` (13 assertions) and the two new ADR-0042 d.5 cases in `046`. **(c)–(e)
  still to do.** Original scope:
  **(a)** Migration: new `sub_task_resources` (`tenant_id`, `sub_task_id` FK cascade, `resource_id`
  FK, `days` integer ≥1, optional `starts_on` date, `notes`, audit + `updated_at` triggers, unique on
  `(sub_task_id, resource_id)`), RLS **enabled and forced** in the same migration, writes gated
  `project_tasks:manage` + the task's write scope — the same authority that edits the task.
  **(b)** `app.sync_subtask_span` narrows to the **assignee's** bookings, so an asset booked outside
  the assignee's days can no longer move or stretch the task's dates (amends ADR-0039 d.5 — its
  pgTAP suite changes with it). **(c)** **WRITTEN 26 Aug** — placement in `placeRequirements`, hour maths in the unit-tested
  `src/lib/bookings/requirement-allocation.ts` (11 tests, incl. DST and a Baghdad working week).
  **A requirement is HOURS, not days** (Edward, 26 Aug — amends ADR-0042 d.3, migration
  `20260826120000` replaces the `days` column). My first cut booked a whole standard day per
  required day, so a camera wanted for three hours blocked the studio until home time and the grid
  reported it unavailable when it was free — the schedule lying about availability. It also
  contradicted ADR-0006 ("hours are the booking vocabulary; load % is derived, never asked"),
  which every other unit of effort here already follows. Hours now fill consecutive working days up
  to a standard day each; `load_pct` carries them for every resource kind, so an equipment chip
  shows its hours too. `subtask-schedule` materialises the
  assignee's days **and**
  one run per required resource in the same pass, and **reports what it could not place** rather
  than failing silently: an exclusive resource whose confirmed booking would overlap (`23P01`) is
  written `tentative` + an exception; an over-ceiling person is written `confirmed` + an exception.
  It may keep deleting by `sub_task_id` — the requirement now survives in its own table.
  **(d)** **DESIGN GAP FOUND AND CLOSED (26 Aug).** ADR-0042 d.6 assumed an exceptions surface
  that does not exist — there is no exceptions table in 91 migrations, and `ExceptionsPanel`
  recomputes counts from the viewer's own open work. Decided (Edward): the **record** of a clash
  is the booking itself (tentative for an exclusive resource, confirmed-and-over-ceiling for a
  person — both already visible on the grid), and the **alert** is a notification. New
  `resource_clash` type + `public.notify_resource_clash` (definer, self-authorizing via
  `app.can_manage_sub_task`, recipients derived not passed, actor excluded); migration
  `20260826110000`, pgTAP `054`. Keeps exceptions derived rather than stored, per ADR-0018.
  Also fixed while here: the `cancelled` notification type has been valid since 24 Aug with **no
  locale key**, so a cancelled-task notification rendered as its raw key. EN+AR added.
  **(e)** **BUILT 26 Aug.** One component, `deliverables/TaskResources.tsx`, on **both**
  `/deliverables` (an expandable row per task, so the table stays scannable) and the `/schedule`
  booking modal (`compact`) — amending ADR-0042 d.7. Owned by `deliverables` because that feature
  already owns sub-tasks; the schedule imports the component, not the hooks. Typed client, not
  `supabaseUntyped` — the types were regenerated first, so this adds no debt. **Every change
  re-materialises the task** and surfaces the scheduler's report: a contested camera says "already
  taken, held tentatively, the assigner has been told" rather than looking booked. The picker
  hides a resource the task already requires (the unique constraint made visible). 9 component
  tests, EN+AR.
  **pgTAP:** RLS allow + deny including cross-tenant and out-of-scope; `days ≥ 1`; cascade on task
  delete; the span trigger ignoring non-assignee bookings; both clash shapes producing a booking +
  an exception rather than a failed assignment; a task with **no** requirements scheduling exactly
  as it does today. **Unit:** the day-placement maths (`days` + optional `starts_on` against the
  task's span).

### I17 — A booking on a non-working day WARNS; it never silently moves (Edward, 27 Aug)
> **Found live, 27 Aug.** A task was assigned to Fadia Wael Amin for Sunday 30 August. The
> booking appeared on Monday 31 August instead, and nothing anywhere said so — the team spent an
> afternoon looking for a booking that had been quietly relocated. Root cause: Baghdad's
> `offices.working_days` did not include Sunday (7). Edward fixed the configuration; the silent
> relocation is the actual bug.
>
> **Edward's requirement, verbatim (27 Aug):** *"the system is supposed to warn that a resource is
> being booked on a non-working day or when a resource is not available.. and it should allow the
> booking when the user confirms proceed anyway after a warning."*
>
> **The code already agrees with him on one path and not the other.** `capacity/engine.ts` says in
> its own comment: *"working week (ADR-0005): non-working days warn; never hidden, never blocked"* —
> and a manual booking on `/schedule` does exactly that. But automatic placement from an assignment
> goes through `subtask-spread.ts`, which ends `return all.filter((d) => office.workingDays.includes(d.isoWeekday))`.
> A non-working day is not warned about there; it is removed from the candidate list, so it was
> never a possible day and the work lands elsewhere unannounced.
- [ ] `I17.1` **Automatic placement reports a day it could not use.** `subtask-schedule` already
  returns `contested` / `overCapacity` / `unplaced` for clashes and over-allocation, and those
  surface as exceptions — a moved day gets none of it. Add the same channel: *"Sunday 30 August is
  not a working day for Baghdad; placed Monday 31 August instead."* **The machinery exists; what is
  missing is the sentence.** Same rule Edward gave for the deliverables proposal the same day:
  nothing fails, or changes what you asked for, in silence.
- [ ] `I17.2` **Warn-then-proceed on the manual path, explicitly.** The engine already returns
  `non_working_day` as a warning and does not block, but the booking dialog must **say so and ask**
  — a warning nobody is shown is not a warning. Same treatment for a resource that is unavailable
  (leave, blackout, `resource_unavailability`). Confirming proceeds; there is no hard refusal.
- [ ] `I17.3` **Check every office's working week.** Baghdad was configured Mon-Fri in a Sun-Thu
  country and nothing surfaced it. Editable in Admin → Organization → Office, so this was
  configuration rather than a missing feature — but the same misconfiguration is silent everywhere
  else too. Worth a one-off audit, and worth considering whether a tenant whose offices disagree
  with their region should be told once at setup.

### I16 — Generated briefs per discipline, approved before work starts (ADR-0048, accepted)
> Edward, 27 Aug: once the inputs are complete — **hand-typed or ingested, one process** — the AI
> generates the deliverables and a brief per discipline, and the account manager reviews, corrects
> and approves before anything is assignable. **No feedback loop: review → correct → approve.**
> Reading the agency brief-template deck (client-supplied, not included in this repository) is what shaped this — the deck's eight briefs
> ARE the current `BRIEF_TYPES`, and its six campaign briefs map one-to-one onto the six disciplines.
- [x] `I16.1` ⚙️🔒 **`brief_templates` (ADR-0048 d.2) — MIGRATION DONE 27 Aug, ADMIN SCREEN DONE 30 Aug.**
  Migration `20260827200000`: table + RLS (read by the tenant, write on `organization:manage`),
  **10 templates seeded, 125 fields** transcribed from the deck including its guidance lines.
  **Also closes a hole Edward spotted (27 Aug): "seeded disciplines will most likely not match
  the organisation's departments."** ADR-0048 d.5 never said how a discipline RESOLVES to a
  brief type — left implicit it was a name match, so the first rename would silently generate
  nothing. New `work_types.brief_type`, nullable on purpose (a discipline the agency invented
  has no template, and that is a valid state, not a guess). 15 pgTAP assertions incl. a rename.
  **Admin → Brief templates DONE** (`/admin/brief-templates`, `organization:manage`): edit any
  template's fields in both languages, and map each discipline to its template. 6 unit tests.
  Original text:
  New table (`tenant_id`, `brief_type`, ordered `fields jsonb` of key + EN/AR label + guidance +
  `multiline`/`required`, `is_active`), RLS enabled and forced, writes on `organization:manage`.
  Seed the six discipline briefs by transcribing the deck **including its guidance lines** — they are
  the model's prompt as well as the human's hint (d.2). New **Admin → Brief templates** screen. **Closed 6 Sep: the admin screen EXISTS** — `src/features/admin/BriefTemplatesPage.tsx`, 22 tests, and it is where a department’s brief templates and its default are set. The “not started” note was stale by a week.
- [x] `I16.2` **Brief types — the templates existed, and NOTHING pointed at them (supersedes
  `I14.4`).** The eleven shipped as data on 27 Aug and no campaign, department or screen ever named
  one, so `generate-brief` had no field list and was never called. Three things were missing and all
  three landed 30 Aug:
  - **A template has a NAME** (`brief_templates.name_en`/`name_ar`). The titles were i18n keys in
    the frontend, which cannot exist for a template a tenant creates — and they were wrong: the app
    read *"360 Campaign"* and *"Paid media / performance"* where the agency's deck says **Creative
    Brief** and **Performance Brief**. Re-seeded from the agency brief-template deck itself, including
    **the deck's own Arabic**, which is the agency's wording rather than the machine-generated MSA
    the rest of the seed carries pending review (I18.8).
  - **A template can be created.** The screen could edit the eleven seeded rows' fields and nothing
    else, so a tenant whose work does not fit the deck had no recourse. New ones arrive with no
    fields, which keeps them unselectable (ADR-0048 d.2) until somebody adds them.
  - **A department may use SEVERAL briefs, and a brief may serve several departments.** Edward:
    *"if I assign Creative Brief to Creative, I cannot assign any other brief to Creative"* — which
    was the defect in my first cut. Creative writes a **Creative Brief** for a 360 campaign and an
    **Execution Brief** for a single banner. Many-to-many on `department_brief_templates`, ticked
    from the TEMPLATE's side on Admin → Brief templates, because *"list all available briefs and
    then select the matching depts"* is how the question is actually asked. Never seeded.
  - **Which of them a campaign uses is chosen at review** (option A, Edward's call — *"if we need
    to change it later we change it"*). One brief per department per campaign stands; a department
    with one available is stated rather than asked about, one with several gets a picker on the
    campaign, and one with none is named. That is the first moment the deliverables exist and the
    kind of work is knowable, which is exactly what ADR-0048 d.5 says decides it.
  **Two wrong turns of mine are recorded in the migration header.** I first put a campaign-wide
  brief type on wizard step 1 — before any deliverable exists, when nothing can know which briefs
  are needed, and against ADR-0048 d.5 which says the confirmed deliverable list decides. Then I
  proposed seeding a department→template map by NAME, which only works if every tenant names their
  departments alike. Edward: *"this is a multitenant system, so we need to accept not everyone uses
  the same org structure… we also need to be able to create new templates and assign them as
  required."* Both reverted. `20260830210000`, corrected the same day by `20260830230000` when the
  one-template-per-department assumption turned out to be a third wrong guess.
- [x] `I16.3` 💰 **AI proposes the deliverable list, never creates it (ADR-0048 d.4) — DONE 27 Aug.**
  New `generate-deliverables` Edge Function + `src/lib/brief/deliverables.ts` + the wizard wiring.
  The OpenAI request moved to `supabase/functions/_shared/model.ts` so a provider switch stays a
  one-file change (ADR-0049) now that two functions call it. Rows are marked `proposed` until
  touched; nothing is proposed over a table somebody has already typed in; a failed call leaves
  the table exactly as usable as before. **No fallback here, deliberately** — a heuristic cannot
  read a deliverable list out of prose, and one nobody could distinguish from a real reading
  would be worse than none. 18 new tests. Original text: New
  `generate-deliverables` operation returning `{name, disciplineId, quantity}[]` **picked from the
  tenant's active `work_types`** — it cannot invent a discipline. Arrives as editable, clearly-marked
  rows in step 3; the **human-confirmed** list decides which briefs generate. Fires on complete
  inputs, not on the AI path (d.3) — no branch asking how the fields were filled.
- [x] `I16.4` 💰 **One brief per discipline — WIRED 30 Aug.** The Edge Function shipped 27 Aug and
  **nothing ever called it**, so `campaign_briefs` was permanently empty and every section of every
  campaign read *"this department's brief has not been written yet"* with no way to change that.
  Found by Edward on 30 Aug, mid-acceptance-run. `useWriteDepartmentBriefs` calls it once per
  department and persists to `campaign_briefs`; a **button on the campaign page**, not a step in the
  wizard, because six departments is six calls at up to 45s each and the person who needs to read
  them is the approver standing on that page. Sequential (a double-click would otherwise be twice
  the model spend), `upsert` so a retry replaces rather than collides, and each department is
  independent — the ones that worked are saved and the ones that failed are named. **Deviation from
  the original text:** it hangs on `campaign_briefs (campaign_id, department_id)`, not
  `streams.brief`; ADR-0050 replaced that months of design ago and the tracker entry never caught
  up. **Still to do:** the per-department brief TYPE picker is I16.6 — until then every department
  uses the campaign's own type.
  Original text: **EDGE FUNCTION DONE 27 Aug, WIZARD WIRING NOT.**
  New `generate-brief` function: takes the master brief, the discipline, its confirmed
  deliverables and its template's field list; returns a value per field. **`N/A`, never blank
  (d.6)** — enforced in code, not just asked for in the prompt, and an empty answer is coerced
  to `N/A` rather than passed through. Over-long answers are reported, never truncated. Shares
  `tidyFieldValue` with the ingest path so the two cannot drift. 12 tests.
  **Still to do: call it from the wizard and persist to `streams.brief`.** Original text: A stream
  already IS one discipline of one campaign, so the brief hangs there — no new table. Fills that
  type's field set from the master brief plus that discipline's deliverables. **`N/A`, not blank, for
  fields that do not apply (d.6)** — amends ADR-0044 d.5 for generated briefs; blank means
  outstanding and gets chased. Bilingual labels, RTL, content never machine-translated (d.12).
- [x] `I16.5` ⚙️🔒 **Campaigns gain `status`; nothing is assignable until approved — DONE 27 Aug.**
  Migration `20260827210000`: `status`/`approved_by`/`approved_at`, two BEFORE triggers gating
  **assignment and booking**, and `public.approve_campaign` restricted to the account manager.
  Every existing campaign was marked `approved` — the migration must not invent a backlog and
  freeze the agency on deploy. Ad-hoc work has no campaign and is deliberately NOT governed.
  11 pgTAP assertions, **every gate driven by a bare UPDATE/INSERT the way PostgREST would** —
  the ADR-0043 lesson, where an invariant living in an RPC was walked straight around.
  Original text:
  `draft` → `pending_approval` → `approved`, **held by a trigger, not only an RPC** — the ADR-0043
  lesson, where a plain PostgREST update went round the RPC that held the invariant. Streams and
  deliverables are still created at submit so the package is reviewable; a sub-task on an unapproved
  campaign cannot be assigned and no booking may be made against it.
- [~] `I16.6` **The approval surface (ADR-0048 d.9/d.10) — PARTLY DONE 30 Aug.** Three things
  landed from the acceptance run: the page **names the approver** (it had the id all along and could
  only say "the account manager", which is no answer to "who do I chase?"); three wrong translation
  keys were rendering as raw keys in the deliverables table — `deliverables.name`,
  `deliverables.state` (which exists, but as the state MAP, so i18next returned the key) and
  `deliverables.states.*` for the plural that never existed; and **approval now notifies the people
  who have to act**. That last one was the sharpest: it notified appointed task REVIEWERS, and at
  approval the tasks are freshly materialised with none — so an approved campaign went live in
  total silence. Now every deliverable owner and every department lead with work on it is told,
  reviewers kept, `distinct` so nobody is told twice, and the approver is never told about their own
  approval. `20260830180000`, pgTAP `076`.
  **A generated brief can now be corrected where it is read** (30 Aug). It was frozen: the model
  wrote it and nobody could change a word, which made *"ready to be reviewed and edited"* untrue
  however good the writing was. Edit turns the same fields into inputs and Save writes the whole
  value map back — the document is edited as one thing, so two halves of one correction cannot land
  separately. Gated on **`projects:manage`**, mirroring the RLS on `campaign_briefs`; it was first
  written against `project_tasks:manage`, which would have offered an Edit whose save the database
  refuses. **Still to do:** editing the MASTER brief and the deliverable list in place — ADR-0048
  d.9 says the whole package is correctable and only the department briefs are so far.
  Original text: The account manager
  (`app.deliverable_account_manager`) sees master brief + deliverables + every discipline brief as one
  package and **edits any of it in place**, then approves. **No changes-requested state and no
  regeneration** — the approver is the corrector, so returning it only adds a hop. Approval releases
  assignability, reveals each brief to its discipline, notifies owners (`campaign_approved`).
  Owners are written as **real rows** — `sub_task_resources` / `sub_task_reviewers`, never free text (d.7).
- [x] `I16.8` **Delivery status is on the campaign page — DONE 31 Aug.** Found by Edward while
  testing: the campaign page had **no progress figure, no blocked count, no overdue count and no due
  dates**. The cause was a **duplicate route** — `800666c` (27 Aug) added `CampaignPage` at
  `/campaigns/:campaignId` and left `CampaignStatusPage` declared at the same path below it. React
  Router matches the first, so the status page and its rollup were unreachable from that commit.
  **Nothing threw, nothing warned, no test failed, CI was green for four days.** Merged onto the
  page in use, per Edward: *"all relevant information captured including exception reporting must be
  on the campaign page in use... all others removed."*
  **What moved:** the campaign-wide rollup (progress bar, done-of-total, blocked, overdue), the same
  figures **per department** — the current grouping (ADR-0050/0053), not the old per-stream one — a
  **state badge** and a **due date** per deliverable, the due date reddened when overdue.
  **What was dropped, deliberately:** the per-stream grouping (streams are not how this page divides
  itself any more) and the back-link/loading/empty chrome the campaign page already has. The rollup
  math moved to `src/lib/campaigns/status.ts` — pure, so it does not belong in a feature, and its old
  home was a cross-feature import edge.
  **Exception-first (ADR-0018 §6.3):** blocked and overdue chips render only when non-zero; a lead
  never reads a row of zeros to learn nothing is wrong. Archived work is excluded from totals but
  still tallied per state; work past its date but delivered or approved is not overdue.
  **This is the Account Manager's Tier-2 slice** (ADR-0018 d.4, deferred by d.7 pending the engine —
  the engine has since landed). The general oversight feed is still `V1.5` and **not built**:
  `exceptions:view` is seeded to five roles and read by nothing in `src/`.
  **Guard: `src/app/router.test.ts`** fails the build if two routes ever declare one path. A
  duplicate is never intentional — two elements cannot both answer one URL, so the second is always
  dead code. Deleted: `CampaignStatusPage`, its test, `lib/campaign-status.*`, five orphaned locale
  keys. 1277 tests green, typecheck clean.
- [ ] `I16.7` **Pending campaigns are chased by the existing sweep (ADR-0048 d.11).** Extend
  `stall-sweep` (`I14.7`) to remind the account manager at `review_reminder_hours` and escalate at
  `review_escalation_hours`. **No new cron entry and no second ladder** — an unapproved campaign is
  stalled work like any other. **Depends on `I14.7`.**
> **Cost note (ADR-0048 consequences):** a six-discipline campaign is up to seven model calls where
> today it is one. ADR-0044 d.9's "one call per ingest, no path can run away" still holds — a person
> still starts it, once — but the per-campaign figure is ~5-7×. Watch spend per approved campaign.
> No aggregate cap added, deliberately, consistent with ADR-0044.


### I15 — Contextual chat for ad-hoc work (ADR-0046, proposed)
> Raised by Edward 27 Aug: opening an ad-hoc task shows no chat window. **Not a bug** — chat is
> campaign-shaped end to end. The frontend omits `<ChatPanel>` in the ad-hoc branch of
> `DeliverableDetail` (`DeliverablesPage.tsx` ~304–317), and even if mounted the `chat` Edge Function
> `open()` 404s because `resolveCampaign` (deliverable→stream/job→campaign) is null for ad-hoc work
> (`stream_id` null, no job campaign). Same campaign-null root as `I11.4` (Library filing), fixed
> separately. **ADR-0046 proposed — awaiting acceptance; nothing built.**
- [x] `I15.1` ⚙️🔒 **Campaign-less chat authorization (ADR-0046).** Replace `resolveCampaign` +
  `onCampaignTeam` with one `contextMembers(ctxType, ctxId)`: campaign anchors unchanged; ad-hoc
  anchors authorize on assignee ∪ `sub_task_reviewers` (ADR-0043) ∪ `created_by` (assigner) ∪ the
  Ad-hoc job's PM/AM (the ADR-0042 d.6 pair), recomputed per `open()`. `open()` 404s only when the
  context resolves to nobody. pgTAP: ad-hoc conversation isolation (member admitted, non-member
  refused, removed reviewer loses access on next open). **Closed 6 Sep** — delivered as `_shared/context-members.ts` plus `app.can_read_conversation` in Postgres (pgTAP `077`). ADR-0062 superseded the shape ADR-0046 proposed; the requirement is met.
- [x] `I15.2` Mount `<ChatPanel contextType="deliverable" contextId={deliverableId} />` in the
  **ad-hoc branch** of `DeliverableDetail` for LIVE work; finished (approved/archived) shows the
  thread history read-only (a record, not a dead composer). **Closed 6 Sep:** built 31 Aug and removed the same day — Edward: *“the chat is not meant to be at the bottom of each section, but a separate page altogether”*. ADR-0063 gave chat its own surface. Not to be built.

## Phase I (cont.) — Taxonomy, workflow templates and the container model (ADR-0051–0058, all accepted 2026-08-28)

> **Recommended order — not the numeric order.** `I20` first (additive; it is the only fix for two
> regressions live in production), then `I22`/`I23` (small, standalone), then `I25` (fixes a real
> review defect), then `I18` (the foundation), then `I19`/`I24`, and `I21` **last** because it is
> the only one that deletes anything.
>
> Migration ordering where it matters: `I18` before `I19`, `I20` and `I24`; `I21` after all of them.

### I18 — A deliverable has a type and a specification (ADR-0051, accepted)

- [x] `I18.1` Migration: `deliverable_categories` (16 rows) + `deliverable_types` (240 rows) +
  `deliverable_attribute_values` (six lists in one table) — all tenant-scoped, RLS in the same
  migration, `name_en`/`name_ar` and `label_en`/`label_ar`, unique on `(tenant_id, code)`
- [x] `I18.2` `app.seed_tenant_deliverable_types(uuid)` seeded from
  `docs/reference/Agency Deliverable Taxonomy.md` **with the Arabic from
  `docs/reference/seed-vocabulary-bilingual.md`**; `on conflict do nothing`; folded into
  `public.seed_tenant_roles` — **copy the CURRENT wrapper (`20260827200000:105-111`), which also
  calls `seed_tenant_brief_templates`**
- [x] `I18.3` `deliverables` gains `deliverable_type_id` (nullable **forever**), `quantity`,
  `channel`, `format`, `orientation`, `production_type`, `complexity`, `client_approval`; read-across
  from `campaigns.brief -> 'deliverables'` in the same migration, losing nothing
- [x] `I18.4` Admin → Deliverable Types: CRUD, deactivate-not-delete, per-tenant attribute lists.
  Also closes the `M6.4` gap *"work types have no CRUD"* — for its replacement
- [x] `I18.5` Wizard step 3 becomes Category → Deliverable → Channel → Format → Quantity → Due →
  Owner. **The largest single UI in this set** — cost it separately
- [x] `I18.6` An untyped deliverable renders "no type set" and is **never filtered out** of a list
  it would otherwise appear in — written as a regression test, not a comment (ADR-0051 d.8)
- [x] `I18.7` 🔒 pgTAP: tenant isolation on all three tables; a tenant adds a seventh
  `client_approval` value **without a migration**; `name_ar` null falls back to `name_en`
- [ ] `I18.8` ⚠️ **Arabic needs a native speaker.** `seed-vocabulary-bilingual.md` carries 472
  seeded rows with **77 marked ⚠**, plus three inconsistencies found in the shipped Arabic:
  البريف vs موجز for "brief", الوعد vs الطرح for "proposition", and "Revision" currently rendering
  as المراجعة, which is already the app's word for "Review"

### I19 — A deliverable type implies a list of unassigned tasks (ADR-0052, accepted) · needs `I18`

- [x] `I19.1` Migration: `workflow_templates` + `workflow_steps` (`sort_order`, `title_en`/`title_ar`,
  `default_hours`), RLS, `organization:manage` to write; adds the FK on
  `deliverable_types.default_workflow_template_id` (ADR-0051 d.15 defers it here)
- [x] `I19.2` Seed 14 templates / 154 steps (WF-01…WF-10 + the four production pipelines), Arabic
  from the same bilingual file. **No step names a person, department, team or role**
- [x] `I19.3` `sub_tasks` gains `workflow_step_id` and `sort_order`, both nullable — a hand-added
  task has neither and behaves identically
- [x] `I19.4` `app.materialise_deliverable_workflow` on an `after insert or update of
  deliverable_type_id` trigger, so a plain `PATCH` cannot set a type and silently create no tasks
- [x] `I19.5` Re-run is idempotent: skip existing, add missing, never duplicate, backed by a partial
  unique index. A type change offers the new template's missing steps rather than forcing them
- [x] `I19.6` **The deadlock fix.** `and st.assignee_id is not null` in both readiness predicates;
  remove the dead `'blocked'` arm (gone from `sub_tasks_status_check` since 19 Aug); stamp
  `deliverables.unassigned_at_signoff`, non-client-writable
- [x] `I19.7` The surface **warns** before sign-off with tasks nobody was assigned — *"3 tasks were
  never assigned. Continue?"* Warn-and-allow, the `I17.2` pattern
- [x] `I19.8` Unassigned as a metric: per deliverable, per campaign, and tenant-wide behind
  `health:view`. **No filter for it exists today** — this is new work, not a query change
- [x] `I19.9` Edit the list: add / remove / retitle / re-date / resequence, before and after
  approval. Removing an **assigned** task warns (`bookings.sub_task_id` is `on delete cascade`);
  resequencing **never** reschedules
- [x] `I19.10` 🔒 pgTAP: materialisation is idempotent; the deadlock (a deliverable with N unassigned
  tasks reaches `in_review`); scope enforcement on the materialiser
- [x] `I19.11` **The join. `deliverable_types.default_workflow_template_id` could not be set by
  anything.** The column was created by `20260828150000`, given its FK by `20260828190000`, and is
  read by `app.materialise_deliverable_workflow` — but no seed, migration or screen ever wrote a
  value into it. On the pilot tenant **0 of 240** types held one, so choosing a type on a
  deliverable materialised no tasks and the whole of I19 was inert in production. A template picker
  now sits on Admin → Deliverable types, saving on change, with a coverage count above the table
  ("N of 240 types create a task list") so that zero can never again be invisible.
- [x] `I19.14` **The seeded templates named the task LIFECYCLE as work** (Edward, 29 Aug, on a
  Content Calendar handed to the creative team: *"everything from Internal Review to Final is not a
  task, it is a step in each task itself… if the list itself is already incorrect, we might as well
  let the user define every task list themselves, which is what is being done poorly now"*).
  **57 of the 154 seeded steps** were Brief, Internal Review, Client Review, Client Presentation,
  Client Approval, Approval, Revision, Amendments or bare Final — none of them work to create.
  A seeding bug against ADR-0052 d.1's own words (*"a checklist of WORK to create. Nothing more"*),
  not a design change, so no new ADR. `WF-01` is now `Copy/Content · Design`, which is exactly what
  Edward said the two real tasks were. Templates are also genuinely editable now: a step can be
  **removed**, not only switched off — safe because `sub_tasks.workflow_step_id` is
  `on delete set null`, so a task already made from it keeps everything and loses only the link.
- [x] `I19.15` **A task whose output cannot be uploaded could not be submitted, so it could never be
  approved, so its deliverable never completed.** `app.sub_task_submit` demanded that task's own
  version (ADR-0058 d.5), which is right for a file and impossible for a shoot day, a print run, an
  installation or a media placement. **Blocked the PRODUCTION team; the creative team was
  unaffected.** ADR-0059 (accepted 30 Aug): a task carries `review_mode`, `digital` or `manual`;
  manual requires the assignee's own note on this round instead of a file, and the reviewer's
  actions, rounds, timers and derived deliverable approval are all unchanged. The workflow step
  carries the **default** (Edward, 30 Aug: *"the toggle sit on the task and the template. The
  template presents the default setting, which can be over written for individual tasks"*) and the
  materialiser **copies** it onto the task, so a template edited later never reaches live work.
  **32 of the 97 seeded steps ship as manual**, approved step by step by Edward on 30 Aug — the
  physical act (Shoot, Production, Installation, Proof, Physical Media), custody rather than
  creation (Ingest, Backup, Archive), and handover (Delivery, Scheduling, Deployment). Prepress
  stays digital: its output is a print-ready PDF. `20260830090000_review_mode_digital_or_manual.sql`,
  pgTAP `073`.
  **Left open deliberately, all three production-team questions and none of them blocking:**
  whether evidence should be attachable to a manual task without becoming the deliverable's version;
  whether some tasks should skip review entirely; whether a manual task's reviewer should be a
  different person.
  **Existing tasks ARE backfilled, once** (d.11), and only where nothing has been decided or done:
  they came from a step, they are still `todo` or `in_progress`, and their mode still reads the
  column default — which it does for every row, because the column was created moments earlier in
  the same transaction. Without it, any task that already exists keeps the trap this closes.
  (On the pilot tenant it may change nothing: the one campaign with a materialised task list, Zeta,
  was deleted on 30 Aug. It stays because it is correct for whatever tasks do exist, and a fenced
  no-op costs nothing.) From today the template never reaches live work: a task started under
  one mode keeps it, and a corrected template changes only the next deliverable made from it.
- [x] `I19.13` **Every deliverable type gets a DEFAULT workflow template** (Edward, 29 Aug:
  *"not one single type creates a task list"* — 0 of 269). `I19.11`'s picker works, but it asked for
  269 choices before the feature did anything, so in practice it did nothing.
  `app.seed_tenant_default_workflows` maps each category to a template, **fills blanks only**, and
  runs last in the provisioning wrapper. Eight of the nineteen mappings are judgement calls and are
  flagged in the migration header for review — `MED` and `AUD` most likely want templates of their
  own. **Recorded correction:** I argued against this mapping on 29 Aug as "the system guessing on
  the tenant's behalf" and had ADR-0051 d.3 backwards. Seeding a default and letting the tenant
  change it *is* seed-then-edit; leaving 269 nulls was shipping the feature switched off.
- [x] `I19.12` **Admin → Workflow templates.** ADR-0052's tracker paragraph named this screen
  ("the migration, the seed, the materialiser and its trigger, the transition guard change, the
  confirmation dialog, the three metrics and **the Admin template screen**") and it never became a
  task ID, so nothing was left unticked to notice. Templates and their steps are now listed,
  renamed in EN + AR, reordered, added, and deactivated-never-deleted. Seeded rows are marked.

> **Why `I19.11`/`I19.12` were missed, recorded so the pattern is visible rather than repeated.**
>
> 1. **pgTAP `065` set the field itself** (`:52`) before exercising the materialiser. The suite
>    asked *"does the engine work when a type has a template?"* and never *"can a type ever get
>    one?"* It passed honestly and proved nothing about reachability.
> 2. **The screen was never a task.** It lived in one line of ADR-0052 prose. Every task that
>    existed was done and ticked, so the tracker showed I19 complete.
> 3. **Nothing in `src/` had ever read `workflow_templates` or `workflow_steps`** — no API module,
>    no screen, no picker. A feature with 14 seeded templates, 154 steps, a materialiser and a
>    pgTAP suite had zero frontend surface, and no gate in the repository notices that.
>
> The check that would have caught it in one line, and is now a permanent part of the acceptance
> run: `select count(*) from deliverable_types where default_workflow_template_id is not null`.
> Generalised: **a seeded table with no reader in `src/` is a feature that cannot be used.** Worth
> running against `sub_task_dependencies` (ADR-0052 d.16 records the same shape: engine built, no
> way to draw an edge) and against Library filing (`I11.4`), both already known.

### I20 — The Discipline label is the department; SLA gains two tiers (ADR-0053, accepted)

> **The SLA half is ⚠️-GATED on ADR-0032**, which is canonical for SLA/accountability and is **not
> finalised** (OD 1/4/5/6/7). `I20.2` and `I20.3` wait for it. Holding them costs nothing:
> `app.effective_sla` has **no callers**, and the pilot holds one profile with `is_default = false`,
> so no deadline resolves through the chain today.
>
> `I20.1` is **merged**. `I20.4` and `I20.5` are independent of the gate and are **done**
> (`20260829090000_department_restamp_and_adhoc_owner.sql`, pgTAP `067`). `I20.6` is done for those
> two and blocked for the tiers — see its note.

- [x] `I20.1` Frontend: all three `deliverables-api` query sites read `departments(name)` instead of
  `streams.work_types(name)` — **done 28 Aug** on `fix/campaign-page-and-department-label`
- [ ] `I20.2` ⚠️(ADR-0032, not finalised) `app.effective_sla` gains a **deliverable-type** tier and a **department** tier; the
  work-type tiers stay below them as a deprecated tail so nothing that resolves today changes
- [ ] `I20.3` ⚠️(ADR-0032, not finalised) `sla_profiles` gains nullable `department_id` and `deliverable_type_id`, with a CHECK
  allowing at most one axis; SLA Profiles admin screen offers all three
- [x] `I20.4` A person changing department **restamps deliverables they own that are still live**;
  `delivered`/`archived` rows are frozen — a delivered row is a record, not a label
- [x] `I20.5` `create_adhoc_deliverable` sets `owner_user_id := p_assignee`, so ad-hoc work has a
  department and a label. (`public.create_internal_project` still creates ownerless deliverables —
  out of scope, tracked in `I22.5`). **Ad-hoc rows created before the migration are deliberately
  NOT backfilled** — the only available guess is the current assignee of the single task, which is
  wrong for any task that was ever reassigned and unreadable afterwards. They keep a null owner and
  can be given one through `reassign_deliverable`.
- [ ] `I20.6` 🔒 pgTAP: the seven-tier chain asserted **tier by tier**; fall-through on a NULL
  `turnaround_hours`; RLS allow/deny on the new axes
  - **Half done, and the other half is gated.** `supabase/tests/067_department_restamp_and_adhoc_owner.sql`
    covers everything ADR-0032 does not touch: the restamp, the freeze on `delivered`/`archived`,
    the owner left alone, the tenant fence on a SECURITY DEFINER trigger, and the ad-hoc owner and
    its derived department. The tier-by-tier chain and the RLS allow/deny on the new axes cannot be
    written until `I20.2`/`I20.3` exist — `app.effective_sla` still has five tiers and
    `sla_profiles` still has one axis, so a test for them would be a test of nothing.

### I21 — `work_types` is retired (ADR-0056, accepted) · needs `I18` + `I20` · **do last**

> ⚠️ The only ADR in this set that deletes anything, and **there is no compiler safety net** — every
> file touching `work_types` is on `supabaseUntyped` and `booking-transition` is Deno.
> **Re-verify the ADR's blast-radius table against `HEAD` before starting**; one row went stale
> within hours of it being written.
>
> **DONE 29 Aug**, with the live data measured first (`I21.1`) and two agreed deviations:
>
> 1. **`I21.5`'s backfill and `work_types_retirement_unmapped` were NOT built** (Edward, 29 Aug).
>    Nothing in the live database references a work type — 0 of 0 streams, 0 of 1 job, 0 of 67
>    bookings, 0 of 1 SLA profile, 0 of 1 KPI definition, and all six rows are the untouched seed
>    with no settings on any of them. A backfill and an audit table would have been built and never
>    executed (`AGENTS.md` §5). **The refusal was kept and broadened**: the migration counts any
>    reference *or* any configured setting and raises rather than dropping, with ADR-0056 d.11's
>    typed escape hatch intact.
> 2. **ADR-0056 d.4/d.5 land short of their stated target**, because they assume ADR-0053 d.2/d.4
>    have shipped and those are `I20.2`/`I20.3`, gated on ADR-0032. `app.effective_sla` therefore
>    has **four** tiers, not six, and `sla_profiles` carries no axis at all. The two missing tiers
>    slot in above the tenant default when the gate lifts; nothing done here needs revisiting.
>
> Shipped as two change sets, not ADR-0056 d.15's single one — the readers moved first, with the
> column still in place, so there was never a moment where the table was gone and a reader was not.
> A single change set cannot be atomic across `db push`, a function deploy and a frontend deploy.

- [x] `I21.1` **Read the pilot tenant's live `sla_profiles` and `kpi_definitions` rows first.** The
  ADR says this is a precondition, not a formality
- [x] `I21.2` `booking-transition/index.ts:475` stops writing `work_type_id`. **Every booking
  creation fails otherwise** — the column name is in the insert payload, so PostgREST rejects the
  whole statement
- [x] `I21.3` `app.seed_tenant_disciplines` dropped and `public.seed_tenant_roles` rewritten without
  it. **Copy the current wrapper** or new-tenant provisioning breaks — on the next customer, not the
  next deploy
- [x] `I21.4` Remaining readers: `campaign-api.ts:49` (dead since ADR-0050, still fatal inside its
  `Promise.all`), `sla-api.ts:51/71/96` (one of them a **write**), `bookings-api.ts:48`
- [~] `I21.5` Backfill maps **departments then teams** (falling back to the team's department);
  `work_types_retirement_unmapped` audit table **with RLS in the same migration**; the migration
  **refuses to drop** while anything is unmapped — a `raise notice` is too easy to miss
  - **The REFUSAL shipped; the backfill and the audit table did not** (Edward, 29 Aug — see the
    block note above). Zero rows referenced a work type, so there was nothing to map and nothing to
    record. If a future tenant arrives with referencing rows, the migration stops rather than
    guessing, and the backfill can be written then against real data instead of imagined data.
  - Also corrected while implementing: ADR-0056 d.9 matches `lower(trim(name))` against
    `departments.name` — **lowercasing one side only**. The pilot's departments are all uppercase,
    so that comparison would have matched nothing and sent every work type to the unmapped table,
    including the one (`Creative` → `CREATIVE`) that genuinely matches. Whoever writes the backfill
    must lower **both** sides.
- [x] `I21.6` Drop the five FK columns and the table
- [x] `I21.7` 20 pgTAP fixtures insert into `work_types`; `031_sla_profiles.sql` also writes
  `work_types.sla_profile_id` and asserts the old chain

### I22 — A deliverable's owner can be changed (ADR-0055, accepted)

- [x] `I22.1` 🔒 **Two live holes, fixable now and independently of the rest.** Add `owner_user_id`
  and `department_id` to the transition guard's reviewer-frozen column list — a `reviews:moderate`
  actor can reassign a deliverable today
- [x] `I22.2` `deliverables:reassign` in `permission_catalog`, seeded to `power_admin`, `scheduler`
  (Traffic Manager) and `account_manager`
- [x] `I22.3` `public.reassign_deliverable` + a **`before update of owner_user_id` trigger** carrying
  the authority test. The trigger is the rule; the RPC is only the ergonomics
- [x] `I22.4` Change-owner control on the deliverable and campaign surfaces; both parties notified
- [x] `I22.5` `public.create_internal_project` created deliverables with no owner. **Edward, 28 Aug:
  an internal project is a project with an internal client and should behave like any other.**
  Option B taken: each deliverable row may name an owner, defaulting to the PM, and **the PM is now
  required** — a campaign cannot be created without an owner per deliverable either. Existing
  internal-project deliverables backfilled to their job's PM where one exists.
- [x] `I22.6` 🔒 pgTAP: **a bare `update deliverables set owner_user_id` by an out-of-scope
  `project_tasks:manage` holder is refused by the trigger** — the hole, asserted closed

### I23 — Documents are reviewed offline until Collabora (ADR-0057, accepted)

- [x] `I23.1` The review panel says *why* a file type cannot be annotated and what to do instead,
  rather than a bare "unsupported" plus a download button. EN + AR
- [x] `I23.2` Comments on a non-annotatable version stay first-class — same rounds, same resolution
- [x] `I23.3` PDF page-anchored annotation — `review_feedback.page` + a viewer. **Needs no editing
  server, so it does not wait for Collabora** (`V1.9`); sequence after `I18`
  - **The viewer is the browser's own**, re-pointed through the `#page=N` PDF Open Parameters
    fragment, rather than a JavaScript PDF renderer. Reason: page anchoring is a page number and a
    jump, and `pdfjs-dist` would add a multi-megabyte dependency plus a worker build for pixel-level
    pins nobody has asked for. The page is TYPED by the reviewer, because a cross-origin built-in
    viewer reports nothing about where the reader is — and inferring one would be a guess presented
    as an anchor. **Edward's call if pin-level PDF annotation is wanted**: it changes one component,
    not the column and not the comment.

### I24 — The model proposes a type from the tenant's own list (ADR-0054, accepted) · needs `I18`

- [ ] `I24.1` ⚠️ **First: verify OpenAI's live enum ceiling** against a 240-value `strict` schema.
  Two sources give 1,000 values / 15,000 chars, but the primary docs page could not be read. If it
  is refused, the fallback (two passes, category then type) is already decided and changes one
  function
  - **Still open — needs Edward.** It is one live billable call against `OPENAI_API_KEY`, which no
    agent holds. `I24.2`–`I24.6` were built without it and do not depend on the answer: the two
    numbers live as `MAX_ENUM_VALUES` / `MAX_ENUM_CHARS` in `src/lib/brief/deliverables.ts`, and a
    list that exceeds either omits `type_code` from the schema and degrades visibly (d.5) rather
    than sending a request the API would refuse. If the real ceiling is below 240, that constant is
    the line that changes; only then does the option-B fallback become necessary.
- [x] `I24.2` `generate-deliverables` reads the caller's active `deliverable_types` **server-side**
  on the caller-scoped client (never client-supplied), builds the enum, and returns
  `{name, type_code, quantity, channel}`
- [x] `I24.3` Codes in the enum, a **category-grouped legend** in the prompt — the grouping is what
  separates `SOC-004` from `VID-008`
- [x] `I24.4` `channel` by **extraction only** — returned only when the brief names it
- [x] `I24.5` `type_code` revalidated server-side; an unrecognised code is dropped and **the row
  survives**; an empty or over-ceiling type list degrades **visibly**, never silently
- [x] `I24.6` Regression test asserting the prompt still forbids naming who does the work (ADR-0050)
- [x] `I24.7` **The single-pass design proposed NOTHING and had to be split** (Edward, 29 Aug).
  A brief plainly listing four deliverables came back empty and silent. Cause was structural, not
  wording: `type_code` was required on the extraction schema with a 240-value enum, and under
  `strict` an empty array is always trivially valid — so a mandatory hard sub-task made the
  degenerate answer the cheapest one. Now two passes: extract, then classify by index. **A failure
  in the classifier costs types, never rows.** ADR-0054 amended (d.1 superseded); its rejection of
  option B was about *category-then-type* and did not reach *extraction-then-classification*.
  The wizard also now states a successful-but-empty proposal instead of showing a blank table, and
  `_shared/model.ts` logs OpenAI's own error message so a refused schema stops reading as an outage.

### I25 — A deliverable is a container; the sub-task is the unit of review (ADR-0058, accepted)

> The largest change in this set and the only one touching the daily-use review path. Its acceptance
> test is that **every existing ad-hoc pgTAP assertion passes unmodified** — if one needs editing to
> pass, the change is wrong.

- [x] `I25.1` `media_records` gains `sub_task_id`; `unique (deliverable_id, version)` becomes
  `unique (sub_task_id, version)`; `deliverable_id` **kept**, so delivery, Library filing, archive
  residency and retention are untouched
- [x] `I25.2` Version stamping numbers **within the task** (`20260818100000:26`)
- [x] `I25.3` `app.sub_task_submit`'s gate asks for **the submitting task's own** version. This is
  the line that lets six tasks pass on one uploaded file
- [x] `I25.4` **Remove `v_stream is null`** from `app.maybe_complete_sub_task`, so a campaign
  deliverable approves itself when the last sub-task is `done`/`cancelled`, exactly as ad-hoc does
- [x] `I25.5` Upload moves to the sub-task; the deliverable-level upload control is removed.
  `ReviewPanel` takes a sub-task — four call sites
- [x] `I25.6` Data migration: attach existing `media_records` to their deliverable's sub-task where
  there is **exactly one**; leave unattached, visible and **reported** where there is more than one.
  A migration may not guess which of three tasks a file belonged to
- [x] `I25.7` 🔒 pgTAP: task A's version does **not** satisfy task B's gate (the defect — must fail
  before, pass after); two tasks each hold a version 1; the last approval carries a **campaign**
  deliverable; **every ad-hoc assertion passes unmodified**

### I26 — A campaign can be withdrawn without hand-written SQL (Edward, 29 Aug)

> **Found by needing it.** A test campaign created through the wizard could not be removed from the
> product at all — no button, no RPC, nothing in `src/`. Removing it took two rounds of DELETE
> statements typed against the production database, and the first round silently did nothing because
> the campaign was named `test campaign` and the script said `Test Campaign`. A delete that matches
> nothing reports success.
>
> The deeper problem is not the missing button. **A campaign cannot always be legally deleted**:
> `sla_events` is append-only by `AGENTS.md` §6 (INSERT policies only, `revoke update, delete`), and
> a deliverable that has emitted one cannot have that row removed without breaking the invariant the
> whole audit story rests on. So "delete the campaign" is sometimes not an available operation, and
> a product that offers a Delete button which fails on exactly the campaigns people most want to
> tidy would be worse than none.

- [ ] `I26.1` **Withdraw, not delete.** `campaigns.status` already exists (`pending_approval` /
  `approved`, ADR-0048 d.8). Add `withdrawn`: the campaign leaves every working list and picker,
  its deliverables stop being assignable, and the record survives. This is the operation that is
  always legal, and it is what the Delete button should do in almost every case.
- [ ] `I26.2` **A hard delete ONLY while there is no history.** The same "plan versus record"
  predicate `public.remove_sub_task` already uses (I19.9): a campaign with no `sla_events`, no
  bookings, no `media_records` and no time entries was only ever a plan, so it can go outright.
  Anything else is withdrawn instead, and the surface **says which happened**, as `remove_sub_task`
  does by returning the word.
- [ ] `I26.3` The deletion order is not obvious and must live in one place, not in a person's head:
  `deliverables` (which cascades `sub_tasks`, `task_time_entries`, `sub_task_resources`, and their
  bookings) → `streams` → `campaigns` (which cascades `campaign_briefs` and library folders).
  `streams.campaign_id` and `deliverables.stream_id` carry **no** cascade, so top-down fails.
  `jobs.source_deliverable_id` also blocks, and is the one an internal project would trip.
- [ ] `I26.4` Authority: whoever may approve a campaign may withdraw it — the account manager
  (`coalesce(campaigns.account_manager_id, clients.account_manager_id)`, the rule
  `app.approve_campaign` already uses). Held by a **trigger**, not only an RPC, the way ADR-0055
  holds reassignment.
- [ ] `I26.5` 🔒 pgTAP: a campaign with an `sla_event` **refuses** the hard delete and is withdrawn
  instead; a campaign with no history is deleted outright; withdrawal removes it from the assignable
  set; a non-account-manager is refused both.

### I27 — What the first acceptance run found (Edward, 29–30 Aug)

> Edward ran the acceptance checklist end to end against the live pilot tenant on 29 Aug. **Every
> item below is a defect it surfaced**, not planned work — which is the point of recording them
> here rather than in a commit message alone: three of the five were invisible to CI, to pgTAP and
> to 1144 unit tests, because each was a gap BETWEEN two pieces that were individually correct.
>
> The run reached step 2.6 and stopped at the approval dead end (`I27.1`). **2.7 onward and all of
> Part 3 are still untested**, and the highest-severity untested item is `3.1`, creating a booking —
> the `I21` regression check.

- [x] `I27.1` **The campaign approval dead end — a campaign nobody could approve.** Four causes
  stacked. `app.approve_campaign` resolves the approver as
  `coalesce(campaigns.account_manager_id, clients.account_manager_id)`;
  `create_campaign_from_brief` never set the campaign's, the client in the test was internal and had
  none either, and `CampaignPage` read only the campaign's — so the button was unreachable on every
  wizard campaign, and unreachable *by anyone* under a client with no account manager. The campaign
  sat at `pending_approval` for ever and ADR-0048 d.8 meant nothing under it could be assigned or
  booked. Fixed in all three places: the page uses the same coalesce the database does, the wizard
  asks for the account manager (`I14.2`), and the surface says *"no account manager is set for this
  client"* when that is the truth rather than blaming an absent person.
- [x] `I27.2` **An internal client could never be saved.** The profile validation asked the ad-hoc
  container what it sells. `is_internal` now skips the commercial half — an internal client needs a
  name and nothing else — and the refusal renders beside the button as well as at the top of the
  dialog, because a disabled button at the bottom of a scrolled form explains nothing.
- [x] `I27.3` **Deliverable dates derived from the campaign go-live** (Edward, 29 Aug). Go-live moves
  to the top of wizard step 4 and is **optional** — *"quite often the client does not want to confirm
  go live"*. Delivery = go-live − 2 days, commence = a further 4 days before that.
  **Fills blanks only** and reports how many rows it left alone: a date somebody typed is a
  commitment, and silently re-planning it is the failure `I17` was raised for. Arithmetic on UTC
  components, so it cannot drift across a DST boundary. `src/lib/campaigns/go-live-dates.ts`, 14 tests.
  **This is a placeholder rule and says so in the file**: `deliverable_types.lead_time_hours` and
  `workflow_steps.default_hours` are the columns built to do it properly and both are entirely
  empty, so today a TVC and a social post get the same six days — visibly wrong rather than quietly
  wrong. When those columns carry real numbers, that one file changes and nothing that calls it does.
- [x] `I27.4` **Errors and confirmations move into dialogs** (Edward, 29 Aug: *"the spinner and the
  error/success messages should all be displayed in modals"*). `NoticeDialog` + `BusyDialog`
  (`src/components/Notice.tsx`), each carrying the caller's original `data-testid` on the message so
  44 existing suites keep asserting the same words. Extends `I12.9`.
- [x] `I27.5` **A searchable owner picker** (`PersonPicker` + `rank-people`), replacing a bare
  `<select>` of every name in the tenant, and three mislabelled wizard columns. Prefix matches rank
  before substring matches; the value is always an id or empty, never a half-selection.

---

### I28 — Booking a campaign task is assigning it (ADR-0060, accepted)

> **The end-to-end path a campaign exists for did not exist.** ADR-0029 is titled *booking-based
> assignment* and `bookings.sub_task_id` is commented *"the sub-task this booking assigns"*. Half of
> it was built: ad-hoc on a person assigns properly, PROJECT mode books a slot and never touches
> `sub_tasks.assignee_id`. So after approving a campaign you could put its tasks on people's
> calendars and every one of them stayed unassigned, with nobody notified.
>
> **Root cause, worth stating plainly: Project mode collects no reviewer.** A live assigned task must
> have one (ADR-0043 d.4, a deferred constraint), so the branch *could not* assign and was left
> booking-only. A missing form field became a missing feature, and nothing was ever marked undone.
>
> Found by Edward on 30 Aug, from the acceptance run.

- [x] `I28.1` **Project mode assigns.** Submitting calls `public.update_task_assignment` (assignee,
  reviewers, dates, hours, review mode) then `subtask-schedule`, exactly as the schedule's Edit modal
  does — no new write path, an existing form pointed at an existing RPC. The bare-booking branch goes.
- [x] `I28.2` **The pickers narrow to what can actually be assigned.** Campaigns filtered to
  `status = 'approved'` (ADR-0048 d.8 refuses the rest in the database, so listing them offers a
  choice that always fails); tasks filtered to the deliverable's **unassigned live** ones — an
  assigned task is already a chip on the grid and is reassigned by dragging it or opening it.
- [x] `I28.3` **Reviewers, review mode and the requirements picker in Project mode**, the same three
  the ad-hoc branch already collects. The reviewer list is what unblocks the whole thing; the
  requirements picker (ADR-0042 d.7) is what keeps "no Project mode on equipment" from being a loss —
  the camera goes on the task from the assignee's own dialog.
- [x] `I28.4` **Two things are removed from Project mode**: assigning a whole DELIVERABLE (Edward:
  *"it will not work… it could assign 14 steps to one person"*), and Project mode on an equipment or
  room resource. Both the client inputs and the matching arms of `booking-transition`, so a second
  caller cannot reintroduce them. **Everything else about bookings is untouched** — plain
  reservations, ad-hoc on equipment, series, blackouts — verified against every caller.
- [x] `I28.5` **"New task" creates a SUB-TASK under the selected deliverable.** Today it inserts a
  new *deliverable* into a stream literally named `General`, created on first use — a second stream
  ADR-0050 abolished, so the row lands on the campaign page as its own section rather than under the
  deliverable the person was looking at. Through `save_sub_task`, so it appears in that deliverable's
  task table, in the unassigned counts and in every metric, because it is an ordinary task.
- [x] `I28.6` **The task's department follows its assignee.** `update_task_assignment` never touched
  `department_id`, while the `/deliverables` add form passes it — so a Creative-owned deliverable's
  Shoot task given to Production stayed counted against Creative in every per-department number. The
  write-scope gate is still evaluated against the task's placement **before** the change, so this
  cannot be used to move a task out of a department the caller has no authority over.
- [x] `I28.7` 🔒 pgTAP: the department and team are stamped from the assignee; the scope gate reads
  the PRE-change placement; assignment on an unapproved campaign still refused `42501` (ADR-0048 d.8
  **unmodified**); an assigned task with no reviewer still refused at commit (ADR-0043 d.4
  **unmodified**); the assignee notification fires.
- [ ] `I28.8` ⚠️ **Edward — deploy ordering.** Removing two `booking-transition` arms means the function must be
  deployed **with or before** the frontend, or Project bookings fail. Same skew shape as `I21`.
- [ ] `I28.9` Existing bookings made the old way (a `deliverable_id`, no `sub_task_id`) are **left
  alone** — they are somebody's real reserved time, and emptying a week nobody agreed to empty is
  worse than a few odd rows. Removing the option stops new ones. Finding and reviewing the old ones
  is a separate decision, recorded here so it is not lost.

---

### I29 — Assigning work says what actually happened (ADR-0061, accepted)

> **One task, five copies, and nobody was told anything.** "Al Waha KV" existed five times on
> `/deliverables` and on `/schedule` for two days. The audit log gave the reason: Dubai's working
> week did not include Sunday until 11:37 that morning, and the three attempts before that booked
> nothing. The task was created every time, the calendar stayed empty, and the dialog said "booked".
>
> Six defects, one family — **the system knew something the person needed to hear and did not say
> it.** Found by Edward, 30 Aug.

- [x] `I29.1` **The scheduler's answer is read.** `subtask-schedule` returns 200 with `scheduled: 0`
  and a reason; every caller checked only whether the call threw, so the body was discarded.
  `src/lib/bookings/schedule-outcome.ts` interprets it: `overridden` and `not_schedulable` stay
  silent (both are ordinary — an unassigned task places nothing, correctly), everything else is
  named, **including a reason the code has never seen**, so the next one added cannot inherit the
  silence.
- [x] `I29.2` **Nothing blocks, including the working week.** ⚠️ **AMENDED by ADR-0078 (9 Sep):**
  the sentence below about a Monday-to-Sunday task no longer describes the system. A count of days
  is a count of WORKING days, so the span moves to fit the days asked for rather than the hours
  compressing to fit the span. The wider decision — nothing blocks — stands and ADR-0078 d.2 applies
  it directly. Original entry: `spreadHours` keeps its behaviour
  whenever the span holds working days — a Monday-to-Sunday task still spreads Monday to Friday —
  and spreads across the calendar days when it holds NONE. A deliberately-chosen Sunday is booked on
  the Sunday. `no_working_days_in_range` is gone. **No override travels from the dialog**: an
  override that has to be passed is one that gets lost on the next re-spread.
- [x] `I29.3` **The submit button covers every mutation the form can start.** `busy` was wired to
  the plain-booking mutation alone, so during an assignment the button neither spun nor disabled —
  two of the five duplicates were **4.2 and 1.4 seconds apart**.
- [x] `I29.4` **Moving somebody's work tells them.** New `rescheduled` notification, on a change of
  DAY only, never to the person who moved it, never from the materialiser (which deletes and
  re-inserts rather than updating). There was no notification type for this at all — the concept did
  not exist, so it was not a missed trigger.
- [x] `I29.5` **Bookable means one thing everywhere.** `resources.is_active` relabelled **Bookable**
  on Admin → Resources (the label only — the column is read by the schedule, the scheduler and the
  admin API, and renaming it buys nothing a user sees). `useAssignableUsers` — the single source for
  every person-picker — now returns only active people with an active linked human resource, and
  `app.person_is_bookable` refuses the assignment in the database so a stale page cannot walk round
  it. **New assignments only:** somebody already holding work keeps it and can still finish it.
- [x] `I29.6` **An ad-hoc deliverable follows its task when cancelled.** Cancelling left it at
  `in_progress`, so an abandoned attempt sat in the Live list looking exactly like real work — most
  of why five rows read as clutter. Ad-hoc state already follows task APPROVAL (`20260825120000`);
  this is the same rule at the other end. Campaign deliverables are untouched.
- [x] `I29.7` **A cascade that reaches nothing says so.** Deactivating a user updates
  `resources where user_id = <them>`; Edward's test subject had `user_id` **null**, so it matched
  zero rows silently and the person stayed on the grid through a hard reload. `update-user` now
  returns how many resources it touched. Reported, never refused — a user with no resource is
  legitimate.
- [x] `I29.8` **Unlinked human resources are marked.** A human resource with no login can be booked
  and belongs to nobody: no assignee, no notification, no My Work, and no user-level switch reaches
  it. Admin → Resources says so. **Not auto-linked by name** — guessing which "Adnan Tawfiq" is
  which is how the wrong two people get paired the first time two names collide.
- [x] `I29.9` **The admin screens refresh the schedule.** `useUpdateUser` invalidated only the users
  list, so the grid kept its cached copy of who exists. The invite mutation has always invalidated
  the schedule; the update one never did.
- [x] `I29.10` 🔒 pgTAP `075` + the fixture correction. **`helpers/seed.sql` gave its people no
  resources at all**, which nothing noticed until assignability depended on it — and `048` was
  asserting "assigning to someone with no bookable calendar is allowed" while deactivating a
  resource linked to nobody, so it passed for a reason it did not intend. Both fixed.
- [x] `I29.13` **A deactivated person cannot be APPOINTED a reviewer.** The picker hid them; the
  write guard never refused them, because it asks `app.user_holds_permission` (role grants and
  overlays) and has never checked whether the account is live. On INSERT only — re-checking on
  UPDATE is the trap ADR-0043's own eligibility comment records, where clearing approvals becomes
  impossible.
- [x] `I29.14` **An appointment made before deactivation survives, and is surfaced.** Deleting it
  would silently drop a reviewer from live work. `WaitingOn` marks them wherever outstanding
  reviewers are already named. **The mandatory case is the dead end**: `maybe_complete_sub_task`
  waits for every mandatory reviewer, so a deactivated one means the task can never complete — the
  tooltip says which of the two situations it is. Not auto-reassigned: who reviews a piece of work
  is a judgement, not a lookup.
- [ ] `I29.11` ⚠️ **Edward — measure before deploying.** `I29.5` makes anybody without an active
  linked human resource unassignable. Count them first:
  `select count(*) from user_profiles up where up.is_active and not exists (select 1 from resources r where r.user_id = up.id and r.kind = 'human' and r.is_active);`
  Every one of those people stops appearing in the assignee pickers the moment this ships. That is
  what was asked for; it should still be a number somebody has seen.
- [x] `I29.12` **The five Al Waha rows: deleted, not cancelled.** Edward, 31 Aug: *"it was a
  mistake and should never happen. I am not designing a system to handle this kind of mistake."* The
  four redundant deliverables and their tasks were removed outright — a `cancelled` deliverable
  state was considered and rejected for exactly that reason. The survivor is `708a4a86` (in review,
  four versions). Audit rows kept. Still open: whether `assignee_no_office` should be prevented at
  the office level rather than caught at scheduling.

---

### I30 — Every action on a task reaches people by EMAIL, not only in-app (Edward, 31 Aug)

> **"We cannot rely on in-app notifications only."** Found while checking whether several reviewers
> on one task all get told. They do — on submit — but two holes sit either side of it: appointing a
> reviewer notifies nobody at all, and six of the thirteen notification types have no email copy, so
> they are silently in-app only. Both are the ADR-0061 family again: the system knows and does not
> say.
>
> The rule Edward set: **every action on a task generates an email.** In-app is the fast lane, not
> the channel. ADR-0028's `due_soon` exclusion (a digest concern, not a per-event mail) is the one
> standing exception and stays until it is revisited deliberately.

- [ ] `I30.1` **Appointing a reviewer tells them.** There is no notification of any kind today:
  `app.tg_subtask_notify_reviewer` fires `after update of status` on `sub_tasks`, so it only ever
  speaks when the task moves INTO review, and nothing at all fires on `sub_task_reviewers` INSERT.
  Add a reviewer to a task already in review and they get no inbox row and no email — they find out
  by opening My Work. On ad-hoc work this is the normal case, not an edge case: the creation RPC
  takes a single reviewer, so a second one is *always* appointed after the fact.
- [x] `I30.2` **`notify-email` has copy for every notification type — DONE 6 Sep.** It was **eight of
  sixteen**, which is worse than the original note said. `notifications_type_check`
  (`20260903130100`) admits sixteen values; `notify-email` carried copy for eight. The seven with no
  email at all were `cancelled`, `resource_clash`, `resource_required`, `campaign_approved`,
  `deliverable_reassigned`, `rescheduled` and `task_reinstated` — each reaching
  `const copy = COPY[locale][row.type]`, finding nothing, and returning
  `200 {skipped:'no_copy'}`: no error, no log line anybody reads, no email. The notification
  appeared in the bell and the email never came. `cancelled` is raised from 28 places. **Now
  fourteen new strings** (seven types × two languages), each mirroring the inbox line under
  `notifications.type.*` rather than inventing a second voice for the same event. **No new deep-link
  case was needed** — all seven carry `sub_task`, `campaign` or `deliverable`, which `deepLink`
  already resolves; that was checked rather than assumed. `due_soon` stays out, as ADR-0028
  intends.
- [x] `I30.3` **A type without copy fails a test, not a person — DONE 6 Sep.** The map is a second
  home for the `notifications_type_check` list, which is why it drifted seven types behind. **The
  type system looked like it already covered this and did not:** `COPY` is
  `Record<Locale, Record<Exclude<NotifType, 'due_soon'>, …>>`, complete against `NotifType` — a
  hand-written union in the same file that was itself seven values behind the database. The compiler
  was checking the second home against itself, which is exactly how this was briefly ticked in error
  earlier the same day. `src/test/notification-copy.test.ts` reads the list **out of the migration**
  and asserts four things: every type has email copy in both languages, no copy exists for a type
  the database forbids, every type has inbox copy in both languages, and the parse itself found a
  real list (a regex matching nothing would make the rest vacuous). Proved to fail by deleting one
  entry before it was trusted. `due_soon` is named as the one deliberate exclusion rather than
  skipped silently.
- [ ] `I30.4` 🔒 pgTAP: **a submit with several reviewers writes one row per reviewer.** No test
  covers the fan-out — `021` and `023` each have exactly one reviewer, so the behaviour is correct
  by reading only. Cover the actor exclusion in the same suite.
- [x] `I30.5` **The email slow lane IS bootstrapped — verified 31 Aug.** Edward tracked a
  `review_requested` mail to Ismail in Resend, sent from a hand-written `notifications` row. So
  trigger (`app.tg_notification_email`) → pg_net → `notify-email` → Resend works on the hosted
  project, and the Vault secrets (`project_url`, `notify_email_bearer`) plus the function's
  `RESEND_API_KEY` / `NOTIFY_EMAIL_FROM` / `APP_BASE_URL` are all in place. **Every gap in this
  section is therefore missing COPY or a missing trigger, never a dead channel.**
- [ ] `I30.7` **A notification names the work AND the campaign it belongs to.** Edward, 8 Sep:
  *"the task title should include the Project/Campaign Title… any reference to a deliverable should
  always also include the Project/Campaign title."* Today `notifications.label` is a bare string
  chosen independently by **fifteen** emitter functions, so an email can say *"Hero KV"* with no
  clue which campaign that is. Decided with it: **an assignment from the schedule names the step
  that was assigned, not the container it sits in** — this is the `notification-email-copy.md`
  decision 3 that produced *"has assigned you to 'Creative'"*, and it is now answered.
  Format `Campaign — Work` (d.1); **ad-hoc work shows the title alone**, no invented prefix (d.2);
  **`resource_clash` keeps naming the resource** and gets its own wording, because a person is not
  in a campaign (d.3).
  **Not fifteen rewrites.** The campaign is resolved centrally from `entity_type`/`entity_id` into a
  new `notifications.context_label`, so every future emitter inherits it and none of them has to
  remember. Only the assignment emitter changes its own label, because that is about WHICH text, not
  about context.
- [x] `I30.8` **The email says enough to decide, lands where the work is, and looks like it came
  from a product — DONE 8 Sep.** Three calls from Edward, all in `notify-email`:
  **(a) A second line, and it carries FACTS not directions.** The draft's line 2 said *"it's on your
  My Work page"* — navigation the button underneath already performs. It is now the due date and the
  hours, resolved from the entity in one best-effort query, so the reader can decide whether to act
  without opening anything. The due date is read as a UTC day deliberately (`I1.7`, traps.md):
  formatting it in a timezone moves it a day west of UTC.
  **(b) A clash email opens the Schedule, not My Work.** This is the ONE place the button is chosen
  by notification TYPE rather than by entity — a clash is recorded against the task, so the entity
  rule sent the reader to their own task list, which says nothing about the camera and offers
  nothing to fix it with. The link carries `who` (the label IS the resource's name, and `who` is the
  grid's name search) and `on` — a new `?on=YYYY-MM-DD` param that opens the week the task falls in,
  because a clash is rarely in the week you happen to be looking at.
  **(c) Table-based HTML, inline styles, no web fonts** — Outlook renders tables and ignores
  `<style>` blocks. Palette transcribed from `src/index.css`, not invented. `dir` flips with the
  locale and every horizontal value is symmetric, so Arabic mirrors without a second template. A
  preheader carries the facts, so the inbox row itself says when the thing is due.
- [ ] `I30.6` **Write the email lane into `docs/RUNBOOK.md`.** It does not mention Resend or Vault at
  all, so the next person to ask "does email actually work?" cannot answer it from the repo. Record
  the chain above, the two Vault secret names, the three function env vars, and `select name from
  vault.secrets;` as the one-line check.

---

### I31 — A conversation is readable by the people accountable for the work (ADR-0062, accepted)

> Found by Edward on 31 Aug testing `/deliverables`: *"there is a chat section that shows 'No
> messages yet'. This is there for some users, for other users it shows Chat isn't available here."*
> Not intermittent — deterministic per person. The gate (`chat/index.ts:85`) admits four kinds of
> person and **has no notion of a reviewer at all**. Measured live: **a large share of users
> refused — the C-suite and every Team Member.** ADR-0046 is superseded by ADR-0062; its
> mechanism is carried forward, its campaign-membership carve-out is not.

- [x] `I31.1` ⚙️🔒 **One `contextMembers(ctxType, ctxId)` for every anchor**, in
  `supabase/functions/_shared/`, replacing `resolveCampaign` + `onCampaignTeam`. Participants =
  assignee ∪ `sub_task_reviewers` (ADR-0043 — **not** the dropped `sub_tasks.reviewer_id`) ∪
  assigner (`created_by`) ∪ owner (`owner_user_id`, ADR-0050) ∪ the campaign's AM. Entitlement =
  participant **or** `app.in_write_scope(p.department_id, p.team_id, campaign.account_manager_id)`
  for any participant **or** `chat:oversight`. `404` only when the anchor resolves to nobody; `403`
  only when genuinely not entitled. Walks **`job_id` as well as `stream_id`** — the bug is that
  `resolveCampaign` already did and the membership query did not. Recomputed per `open()`, never
  cached (ADR-0062 d.5). `explain` the campaign-anchor path before merge.
- [x] `I31.2` 🔒 Migration: **`chat:oversight`** in `permission_catalog`, seeded to `power_admin`,
  `scheduler` (Traffic Manager) and the four C-suite roles. Checked with `app.has_permission` on the
  **caller-scoped** client (ADR-0037 — service-role has no `auth.uid()` and resolves every grant to
  false; this exact bug was fixed once already in this same function). ADR-0033 `search_path` pin.
- [x] `I31.3` 🔒 Migration: **`conversation_members.added_by uuid null`** — null = written by
  derivation, carries no entitlement (the join record of ADR-0062 d.5); non-null = an explicit
  grant, server-stamped (the `user_grants.granted_by` precedent, L6.1). RLS in the same migration.
  Plus `on delete cascade` on the anchor and deletion of the one live orphan — shared with `I32.5`,
  build once.
- [x] `I31.4` ⚙️ **`add_member` / `remove_member` ops** on the `chat` function. ADR-0015 §6 has
  always required this (*"add/remove members go through Edge Functions"*) and this is the first
  implementation. May add: participants, leads in scope, **and `chat:oversight` holders — who are
  full participants, not observers** (Edward, 31 Aug). May **not** add: a member who was themselves
  explicitly added, so an invitation cannot fan out. Never `client_portal`, never cross-tenant.
  Removal revokes the **explicit grant only** — removing a derived participant must *say* it did
  nothing rather than appear to succeed. Audited both directions.
- [x] `I31.5` **`isAdhoc` is derived from the deliverable, not the tab.** `DeliverablesPage.tsx:337`
  reads `tab === 'adhoc'`, so ad-hoc reached by a deep link, a notification or the wrong tab skips
  the early return and mounts a panel that cannot work. Mount the panel on live ad-hoc work;
  finished ad-hoc (`approved`/`archived`) shows the thread read-only (ADR-0062 d.7).
- [x] `I31.6` **The surface tells refusal from breakage.** `chat.unavailable` is one string for 403,
  404, 500 and a network failure — which is why this looked random for four days. Split into at
  least *not entitled* / *nothing to talk about yet* / *the call failed*. EN + AR.
- [x] `I31.7` **Being added to a conversation notifies, in-app AND by email** — `I30`'s standing
  rule; being pulled into a discussion is an action on the work. New notification type,
  `notify-email` copy in both languages, deep link resolved. Do it **with `I30.2`**, not after it.
- [x] `I31.8` 🔒 pgTAP (ADR-0062 d.10): non-participant outside scope refused · assignee, reviewer,
  assigner, owner each admitted · a **removed** reviewer loses access on the next `open()` · a Team
  Leader admitted to their own team member's thread and refused another team's · a Department Lead
  reaches every team in their department · an overlay scope-grant admits exactly the granted
  department · `chat:oversight` reaches, **posts in and adds to** a thread its holder has no other
  connection to · `chat:oversight` alone does **not** admit to a `dm`/`group` · an invited member
  reads, and **cannot invite** a third · removing an invitation revokes; removing a derived
  participant does not · `client_portal` refused everywhere and never invitable · cross-tenant
  refused. Existing `020_chat_isolation` cases unmodified.


**`I31` DONE 31 Aug — built, verified, NOT deployed (Edward applies migrations and deploys).**

- **Three migrations.** `20260831120000` adds the oversight permission — **named
  `chat_oversight:view`, not ADR-0062 d.4's `chat:oversight`**, because `permission_catalog.action`
  admits only view/create/update/delete/approve/export/manage/moderate; the ADR-0055
  narrow-resource precedent is followed and the deviation is recorded in the migration header.
  `20260831120100` carries the entitlement itself. `20260831120200` adds the `chat_added`
  notification type.
- **The decision moved into Postgres**, which ADR-0062 d.1 did not anticipate and d.3 forces:
  `app.in_write_scope` is not reachable over PostgREST, so the scope axis cannot be evaluated in an
  Edge Function at all. `_shared/context-members.ts` is the module d.1 asks for; it is a thin caller
  of `public.can_read_conversation`, the same doorway shape ADR-0037 set for `has_permission`. The
  decisive benefit is that pgTAP can now prove the rule.
- **The adversarial suite found a real hole before Edward did.** `chat_oversight` short-circuited
  ahead of any tenant check, so a Traffic Manager in tenant B could read tenant A's conversations —
  the permission is held in the CALLER's tenant and nothing asked whose work the thread was about.
  Fixed with `app.conversation_in_tenant`, required before every branch. `077` test 20 is that case.
- **`chat` also gained Zod at the boundary**, removing it from the five functions STATE.md lists as
  parsing input unvalidated. Its anchor-existence check is three literal `.from()` calls rather than
  one computed table name, so `postgrest-selects.test.ts` can still read it.
- **Verified:** `scripts/db/verify.sh` green — 78 files, **847 assertions**, 22 of them new.
  1297 unit tests, typecheck clean, `check:authz` clean, 0 lint errors.
- **Edward's actions:** `supabase db push` · `supabase functions deploy chat` ·
  `supabase functions deploy notify-email` · regenerate `src/types/database.ts`. **Deploy the
  migrations BEFORE the functions** — `contextMembers` fails closed, so a function deployed early
  refuses everyone rather than admitting them.
- **Still open, deliberately:** `I32` (the `/chat` surface) is untouched; the member list built here
  lives on the existing panel only. `I30.2`'s other five missing email types are unchanged — only
  `chat_added` was added, alongside its type.

---

### I32 — Chat has a home of its own (ADR-0063, accepted) · follows `I31`

> Chat is reachable only from the foot of a deliverable, so a thread can be found only by
> remembering which deliverable it hung on. No list, no unread count, no way to see somebody wrote
> to you. ADR-0027 §4 decided the rollup in August; this gives it its own surface. **Do not start
> before `I31`** — a list of conversations the caller cannot open is not worth building.

- [x] `I32.1` **`/chat` route + left rail built from ENTITLED WORK, not from existing
  conversations.** A `conversations` list would show **four rows and zero messages** — rooms are
  created lazily — and read as broken. Rail rows come from the anchors `contextMembers` admits the
  caller to, whether or not a row exists; opening get-or-creates as the panel does today. Nav entry
  with an unread badge, beside the notification inbox, not inside it.
- [x] `I32.2` **Two tiers plus ad-hoc.** Campaign → its deliverable threads; **Ad-hoc** as its own
  top-level group (it has no campaign, and it is most of the alpha's work). **No sub-task tier** —
  a task already has anchored review comments (ADR-0025/0057) and the manual-review thread
  (ADR-0059); `context_type='sub_task'` stays permitted by the schema and unused by the product. A
  person added to ONE thread sees that campaign as a **header with only that thread beneath it** —
  never the campaign's other contents, never an orphan row.
- [x] `I32.3` **Member list visible on every conversation, on both surfaces**, each person carrying
  **why** they are there: assignee · reviewer · assigner · owner · AM · *lead over this work* ·
  *management* · **added by <name>**. Computed from `contextMembers` — if the list and the gate ever
  disagree the list is wrong, because there is only one source. This is what closes the lurking gap
  ADR-0062 leaves open. **Read receipts are excluded on purpose** (`last_read_seq` would make them
  trivial): visible entitlement is transparency, visible reading is monitoring.
- [x] `I32.4` **Unread first, then most recent.** `conversation_members.last_read_seq` vs the
  conversation's max `seq` for the count; `conversations.last_message_at` — already maintained by
  the trigger in `20260818120000`, commented *"keep hot for inbox sort"* — for the tiebreak. A row
  with no conversation yet sorts last and shows no count. No phantom badges.
- [x] `I32.5` 🔒 **A conversation does not outlive its anchor.** One live conversation points at a
  deliverable deleted 29 Aug; there is no cascade and the row is unreachable and permanent. Add the
  cascade, delete the orphan. Shared with `I31.3` — one migration.
- [x] `I32.6` **Layout: Discord's three columns** (rail / messages / members), **structure only**.
  Not taken: joining or leaving (membership is derived, ADR-0062), `@everyone`, voice, discovery,
  any social surface. Maestro's own visual language governs type, colour, density and **RTL** —
  skill `maestro-design`. e2e per role: a Team Member sees only their own work; an oversight holder
  sees every work room; an invited member sees one thread under its campaign header and nothing
  else.


**`I32` DONE 31 Aug — built and verified locally. ONE NEW MIGRATION to push.**

- **`/chat`**, in the nav under My Work, gated on `my_tasks:view` — the grant every internal role
  holds. Chat is not a privilege: the RAIL decides what each person sees, row by row, through the
  same entitlement `open()` uses. Somebody with no work sees an empty state, not a refusal.
- **`20260831130000` adds `public.my_conversations()`** — the rail. It lists **entitled work**, not
  existing conversations: rooms are lazy, so a `conversations` listing would have shown four rows
  and no campaigns and read as broken. Every candidate is filtered through
  `app.can_read_conversation`, so the rail cannot offer a thread the caller would then be refused.
  **Needs `supabase db push` + `gen types`.**
- **Three columns**, campaign → deliverables, ad-hoc its own top-level group, members on the thread.
  **No sub-task tier** (d.3): a task already has anchored review comments and the manual-review
  thread, and a third box would be three places to type with no signal which to use.
- **The open thread lives in the URL** (`?type=&id=`), so a conversation can be linked to — which a
  notification deep link will need, and which makes the back button behave.
- **Performance, stated not discovered:** the entitlement function runs once per candidate
  deliverable (131 live). Tens of milliseconds now, O(n) in the tenant's deliverables. ADR-0063
  already flags pagination at volume; the fix then is a set-based rewrite of the entitled set, NOT a
  cached membership table — the thing ADR-0062 d.5 exists to prevent.
- **Verified:** 88 files / **1314 unit tests**, `db/verify.sh` 847 assertions, typecheck clean,
  0 lint errors, production build clean.

**Found and fixed while wiring this up:** `src/types/database.ts` came back from `gen types` as
**UTF-16 LE with a BOM** — 244 KB for a 122 KB file, and invisible to `grep`. PowerShell's `>` and
`Out-File` default to UTF-16 on 5.1. Converted to UTF-8. **The README/CLAUDE.md command should be
`| Out-File -Encoding utf8`** and it is worth checking the file's first bytes after every
regeneration; a UTF-16 file still compiles, so nothing else catches it.

### I33 — A capsule declares what it is for, and a session records what it loaded (ADR-0064, accepted)

> `docs/memory/` already implements OpenViking's core idea — tiered loading, each tier deciding
> whether the next is needed. Two cheap borrowings it does not implement: a capsule has no
> machine-readable "should I open this?" line, and nothing anywhere records what context a task was
> actually given. Conventions + lint only. **No product code, no schema, no dependency.**

- [x] `I33.1` **Mandatory `abstract:` on every capsule** — one sentence, **≤ 140 characters**, the
  L0 load-or-skip line an agent reads *instead of* opening the capsule. Backfilled on all six,
  derived from each capsule's existing `**Purpose:**` line, `origin:` unchanged (`ai-derived` on all
  six). **`verified:` deliberately NOT bumped** — that date means "checked against the code" and
  rewriting a summary line checks nothing.
- [x] `I33.2` **The abstract REPLACES the `**Purpose:**` body line, which is deleted** (ADR-0064
  d.4). They said the same thing four lines apart in one file. All six judgement sentences fit
  inside the cap alongside their scope sentence, so nothing is lost — and front matter is not
  counted against `CAPSULE_MAX_LINES`, so **two body lines come back in every capsule**.
- [x] `I33.3` **Scope leads, judgement second** (d.5) — a line opening on *the easiest thing to get
  subtly wrong* is a teaser, not a routing signal. The test is that the **first clause alone** would
  route a task correctly. All six checked against it. **Not lintable** (no regex separates scope from
  judgement); it is a review rule, written into `docs/memory/README.md`.
- [x] `I33.4` **`MAP.md` carries a verbatim copy** in each routing row, so the map alone answers
  *is this the right capsule?* without opening one.
- [x] `I33.5` **`memory-lint.mjs` enforces it as ERRORS** — present · ≤ 140 · one sentence · no
  leading `[` · **and the `MAP.md` copy matches the capsule character for character**. That last one
  is what makes d.4's duplication safe: a copy a script checks is a cache, not drift. Zero
  dependencies kept; the existing error/warning split kept (errors are provable now, warnings are a
  human's judgement). The one-sentence test is `[.!?]` + whitespace + capital — **not** a bare `\.`,
  which would reject `router.tsx` and `src/app/`.
- [x] `I33.6` **Retrieval trajectory** (d.8) — `/memory-start` ends its report with a fenced block:
  capsule loaded (or `none — no row matched`), ADR numbers, files actually opened, tier-1 notes read.
- [x] `I33.7` **`/memory-close` records it under `**Loaded**`** in a session note, `missed:` filled
  in — what the task turned out to need that `MAP.md` did not route to. Only fillable in hindsight,
  and the only evidence for *why did the agent miss X*. A `missed:` that keeps naming one capsule
  means a routing row is wrong.
- [x] `I33.8` **Trajectory logging never causes a session note to exist** (d.10) —
  `sessions/README.md`'s rule is untouched: notes on Edward's ask, or work left mid-flight. Most
  sessions still write nothing and report the trajectory in-session.
- [x] `I33.9` **Front-matter spec updated** in `docs/memory/README.md`, including the constraint that
  the abstract is a plain unquoted scalar never starting with `[` — the linter's front-matter reader
  is a nine-line regex, not YAML, and the alternative is a dependency (`AGENTS.md` §1).

**`I33` DONE 31 Aug — documentation and lint only; nothing to push, nothing to deploy.**

- **Verified by fault injection, not by a clean run.** A green lint proves nothing if the new checks
  are dead code, so each was made to fail on purpose and then restored: missing · empty · 141 chars ·
  two sentences · leading `[` · `MAP.md` copy drifted · `MAP.md` copy absent. All seven raised the
  intended error and exited 1; restored state exits 0 at **13 notes clean**.
- **Deliberately not done:** `abstract:` on the 65 files in `docs/adr/` (ADR-0064 d.12). They are not
  tiered-loaded, and `docs/adr/README.md` already carries a denser per-ADR summary — backfilling
  would add a second copy that nothing checks, which is the thing d.6 exists to prevent.
- **Noted, not fixed** (Edward tracks separately): `CLAUDE.md` says the ADR log runs "0001–0042" and
  `MAP.md`'s decision column cites nothing above 0042, while `docs/adr/` holds 65 files up to 0064.
  Numbering is sound — no duplicates, no gaps — so this is documentation lag, not collision.


### I34 — The model proposes concepts, traceable to the brief (ADR-0065, accepted)
> A department brief today is the campaign brief re-boxed — `generate-brief` is forbidden from
> creative work by its own prompt. This adds a **second, separate** call that proposes an approach
> for each department that received a brief. Same rule about facts (never generated), different
> permission about ideas (may be proposed, must answer the brief). One to four departments per
> campaign, so cost lands at roughly a third to a half more per campaign on ADR-0049's ~$0.005 base.
- [x] `I34.1` 🔒 **`campaign_concepts` + RLS in the same migration** — tenant-scoped, keyed
  `(campaign_id, department_id)`, stored **apart from `campaign_briefs`** (d.6): approving a brief
  never approves concepts. RLS mirrors the brief's. Regeneration is **additive** (d.8), so a set
  carries its own created-at and nothing is overwritten. Paired pgTAP: tenant isolation, and that a
  concept row is reachable by exactly the people who can read its brief.
- [x] `I34.2` ⚙️ **`propose-concepts` Edge Function** — Zod at the boundary (`AGENTS.md` §5), shared
  `_shared/model.ts`, `OPENAI_MODEL` unchanged (d.9). Two closed enums built **server-side at call
  time under RLS, never from the browser** (ADR-0054's pattern): the department's brief field keys
  for `answers` (d.4), and the tenant's active `deliverable_types` codes for suggested content types
  (d.3). Output typed into the four shapes, Zod-validated, unrecognised keys dropped with the
  proposal surviving.
- [x] `I34.3` **The fact rule is SHARED TEXT, not a second copy** (Consequences) — `generate-brief`
  and `propose-concepts` both forbid generated facts, and two copies of that sentence will drift.
  Extract it to `_shared/` and import, the way `tidyFieldValue` already is. This is the one thing in
  `I34` that is not optional.
- [x] `I34.4` **Surface** — on-demand button gated `projects:manage` (d.7), newest set first, discard
  per set. Each proposal shows the requirements it answers; one that cites nothing is rendered
  **marked as unsupported, never hidden** (d.5). Concepts are visibly a proposal, not brief content.
  EN/AR, RTL.
- [x] `I34.7` **The campaign page reads as a document, and names who is accountable (Edward, 2 Sep,
  from live use).** *"Presented as a stack with extremely unprofessional formatting… the Campaign
  Account Manager and none of the Deliverables Managers are identified."* Three defects, one screen.
  **(a) The brief was a `<dl>` of stacked rows** — an 11px grey label over a paragraph capped at
  72ch, fourteen of them down the left edge of a wide screen. Now `.brief-grid`: `auto-fit` +
  `minmax(min(280px,100%),1fr)` so columns follow the viewport and collapse to one on a laptop with
  no breakpoint to maintain, `grid-auto-flow: dense` to backfill the ragged gaps a mixed-length
  brief always leaves, and each field a titled panel as the agency's own deck lays them out. Width
  is decided by **content length** (`> 240` chars spans two columns, guarded to ≥900px so a
  one-column grid can never be forced to scroll), not a hard-coded list of "long" fields — department
  templates are tenant-defined, so no static list could cover them. `N/A` recedes rather than
  disappearing: ADR-0048 d.6 makes it a real answer, and dropping it would leave a reader unable to
  tell it from a field nobody filled. **(b) The master brief splits into two bands** — the strategy
  brief and the performance flight, which are two documents in the deck
  (the agency performance-marketing brief template). The performance band appears **only when the
  campaign has one**; five "Not applicable" panels under a Performance heading is five panels of
  nothing on the campaigns most likely to be purely creative. `PERFORMANCE_FIELD_KEYS` moved out of
  `BriefWizard` into `lib/brief/fields` so the wizard and the reader cannot disagree about which
  fields those are. **(c) Nobody was named.** The account manager's id AND name were already in
  `useCampaignDetail` and printed nowhere, so the first question on an approval screen was
  unanswerable from it; now in the header, or *"Not assigned"* where there is no approver, which is
  itself worth seeing. Deliverable owners existed as `owner_user_id` with **no name anywhere in the
  query** — added as a named embed (`deliverables` has TWO FKs to `user_profiles`, so an unnamed one
  returns EMPTY, not an error), surfaced as an **Owner column** and as the department's distinct
  owners on its heading row. **RTL:** the new micro-labels drop `letter-spacing` under `dir="rtl"` —
  Arabic is cursive and positive tracking pulls apart letters that must join. **Eleven older rules in
  `index.css` have the same defect and are deliberately NOT touched here** — that is its own sweep,
  not something to smuggle into a campaign-page change. Six new tests. 1401 green with `.env` moved
  aside; typecheck and lint clean. **Not seen in a browser** — verified at the unit level only.
- [ ] `I34.5` **Measure the cost against the estimate, once, on real campaigns.** ADR-0065 predicts a
  third to a half more per campaign; the OpenAI dashboard already carries the baseline. If it lands
  materially over, that is a finding worth writing down, not a surprise to absorb — and d.9 means the
  answer is a config change, not a code change.
- [x] `I34.6` ~~⚠️~~ **Residency — closed by Edward, 2 Sep.** The gate this item held on
  `propose-concepts` is lifted: concepts add volume and frequency, not a new CATEGORY of data
  leaving the tenant, since department briefs already reach OpenAI. **The basis was not stated to
  me and is therefore not recorded here** — one line saying what was confirmed on the OpenAI
  account (no-training default; whether zero retention is required) belongs in this entry. Closing
  this checkbox does NOT close the ADR-level item: ADR-0049 d.6 re-opened ADR-0044 d.6, and only
  an amendment to that ADR closes it.

---

### I35 — Documents arrive with the brief, and the brief's arrival is evidenced (ADR-0066 + ADR-0067, accepted)
> Edward, 3 Sep, from live use of the wizard. Five asks that turned out to be one feature and two
> decisions: **brand documents** and **campaign reference materials** uploaded during the wizard and
> filed into chosen folders; an **Add brand** option where none exists; **original filenames** on
> download; and a **screenshot of the brief request** as evidence of issuance, read by the model,
> confirmed by a person, with a **T+ approval exception** on the dashboards. ADR-0067 is what makes
> filing-during-the-wizard possible at all (the campaign must exist to have folders); ADR-0066 is the
> evidence and the clock.
- [x] `I35.1` **Downloads keep the name the person uploaded** — the name was never lost:
  `assets.name` has always held `file.name` and the Library lists it correctly. The defect was that
  **neither signing function told the browser**, so a presigned GET fell back to the last path
  segment and surfaced the object key (`a3f9c1e2-…-Harmony_Brief_v2.pdf`). `asset-url` sent no
  `Content-Disposition` at all; `review-media` sent `attachment` **with no filename**, which is why
  review downloads looked identical. New `_shared/download-name.ts` builds the header in **both** the
  UTF-8 and ASCII forms — without the ASCII fallback an Arabic filename degrades back to the key,
  which is the bug — and strips (never escapes) quotes, backslashes and newlines, since those are
  header-injection vectors and no real filename needs them. The disposition is set **before signing**:
  it travels as a query parameter, so appending it afterwards would invalidate the signature. 9 tests.
  **Found while doing it:** `media_records` has **no filename column at all** — the name reaches the
  upload signer and is discarded — so review downloads are recovered from the key by stripping the
  uuid prefix, which yields the *sanitised* name (underscores where the spaces were), not the
  original. That is a recovery, not a fix; `I35.7` is the fix.
- [x] `I35.2` **Brand documents on step 1, multiple, filed into a folder the user picks.** Nothing new
  was needed underneath: `app.provision_brand_folders` has always created **Logos / Fonts /
  Guidelines / Key Visuals** the moment a brand exists, and **nothing in the app had ever put a file
  in one**. Brand folders exist as soon as the brand does, so these upload immediately — no staging,
  and abandoning the wizard correctly leaves them filed, because they belong to the brand and not to
  a campaign that never happened. **Only once a brand is chosen**: a client-level fallback would
  file guidelines somewhere nobody looks for them, so there deliberately is not one.
  `useFileDocuments` (`api/document-filing-api.ts`) uploads **one file at a time and reports per
  FILE, never per batch** — filing needs `assets:manage`, which the wizard itself does not require
  (ADR-0044 §8), so a partial batch is an ordinary outcome and *"one document could not be filed"*
  tells nobody what to retry. The failures are **named**. A person without the grant is told **up
  front**, and can still browse the filing structure — seeing where things are filed is not the same
  as adding to it.
- [x] `I35.3` **An `Add brand…` option in the wizard's brand dropdown**, opening a modal that
  registers one. The option lives **in the dropdown**, because that is where somebody looks when the
  brand they want is not there; a `__add_brand__` sentinel that cannot collide with a uuid opens the
  modal and leaves the selection untouched, so cancelling changes nothing — tested, because that
  sentinel reaching `brandId` would be submitted as a brand id and fail at the foreign key. On
  success the new brand is **selected immediately**, and its folders already exist because the
  insert provisioned them. **Client + name only, deliberately** (Edward, 3 Sep): that is *all* a
  brand is today, and it is exactly what client registration collects. The INSERT moved to
  **`lib/brands.ts`, shared with client registration** — Edward asked for it *as per the existing
  brand registration*, and two copies of one insert is how "as per" quietly stops being true. The
  shared writer deliberately invalidates nothing: knowing either surface's query keys would be a
  `lib/` module reaching back into a feature. Duplicate name reads as a sentence, EN + AR.
  **Additional Brand/IP attributes are a known future step** and want their own schema decision;
  this entry is where that is recorded so it is not rediscovered.
- [x] `I35.4` 🔒 **Campaign reference materials on step 2, and the draft campaign that makes it
  possible (ADR-0067).** Step 1 → 2 creates the campaign as `status = 'draft'` (`20260903100100`);
  folder provisioning already runs on insert, so Working Files / Deliverables / Final Assets /
  References come free. Submit completes it and moves it to `pending_approval`. Going back and
  forward again **updates** rather than creating a second one, and a **duplicate name now surfaces
  at step 2** instead of after five steps of typing (d.5).
  **`app.write_campaign_content` is the one content writer**, shared by the one-shot RPC and the
  draft path, so ADR-0051's specification and ADR-0050's owner-stamped department have a single
  implementation. **The seven readers of `campaigns` were the checklist**: `campaign-api` (now
  carries `status` and splits the list), `campaign-detail-api` (already typed for `draft`),
  `bookings-api` and `deliverables-api` (**were unfiltered** — both would have offered a draft as
  a pickable campaign with nothing inside it; now `neq('status','draft')`), `schedule-api` (already
  `approved`), and two in `chat` (an anchor by id, unaffected). Campaigns list shows drafts
  **separately as unfinished** with **Continue** and an armed **Discard**; the wizard resumes one
  from `?draft=`. Drafts are **never swept** (d.7) and the database refuses to discard one holding
  documents — surfaced as a sentence, not a constraint. **ADR-0044 §8's after-submit filing is
  retired**: the ingested brief document is filed into References the moment it is read, and the
  promise-then-apologise retry pair goes with the staging it existed for. 7 new wizard tests, 5 new
  campaigns-list tests, 12 pgTAP.

  **Found by the pgTAP suite on its first run, and worth remembering:** `revoke execute ... from
  public` on `app.write_campaign_content` also stripped `authenticated`, which inherits from
  `PUBLIC` — so submit failed with a bare `permission denied for function`. Revoke, then grant
  back explicitly. Granting it opens no door: PostgREST serves `public` only, and the function is
  `security invoker`.
- [x] `I35.5` 🔒⚙️ **Brief receipt: the screenshot, read by the model, confirmed by a person
  (ADR-0066).** New receipt table + RLS in the same migration, paired pgTAP. The image is **pasted or
  chosen**, filed as an **ordinary asset** in the campaign's References folder (d.2) — evidence
  lives in the Library, not in a private column — and a pasted image, which has no filename, is
  named deterministically from the confirmed receipt. New Edge Function reading the image through
  `_shared/model.ts`, extended **additively** so it stays the single call site (ADR-0049); no tools,
  as ever (ADR-0044 d.4). Subject / date / time arrive **machine-filled and marked**, exactly as
  ingested brief fields do. **`received_at` is the timestamp INSIDE the image; `captured_at` is when
  it reached us; the clock uses the first and never the second** (d.5). **A partial timestamp stays
  partial** (d.13) — WhatsApp shows `14:32`, mail shows `Yesterday` — because completing one is
  an inference the model is not allowed to make; the person completes it. Timezone is the confirming
  person's office, **shown** (d.14). **Interface copy must ask for a cropped capture**: an inbox
  screenshot carries other senders, other subject lines and phone numbers, and it goes to the Library
  *and* to OpenAI — that is the ADR's named consequence and this is where it is honoured. EN/AR, RTL.

  **Built 3 Sep.** Migration `20260903100200` + `079_campaign_brief_receipts.sql` (14 assertions);
  `read-brief-receipt` Edge Function + 18 handler tests; `_shared/model.ts` extended **additively**
  so a caller sending no image produces a byte-identical request and the other four functions did
  not need redeploying; `BriefReceiptPanel` (11 tests) and `brief-receipt-api` (8). **Two findings
  worth keeping.** `Date.parse('2026-02-31')` does **not** return NaN — V8 rolls it over to 3 March
  and hands back a valid timestamp, so a model that miscounted a month would have started the clock
  two days late, silently; the check now round-trips the parts through `Date.UTC` and compares them
  back. And resolving a wall-clock reading in a named zone needs **two passes**, because the offset
  depends on the date and the first guess is what says which side of a DST boundary you are on —
  pinned on both sides of 29 March 2026. **A defect Edward found by asking when the details are
  saved:** `recordReceipt` runs on every Next from step 1 (right — the date may have been
  corrected), and it re-uploaded the screenshot each time, so three trips back and forth left three
  copies in References with the receipt pointing at the last. `assets` has no unique constraint to
  catch that and the receipt row does, which is exactly why it would have stayed silent. Guarded by
  File identity (not name — two screenshots can both be `image.png`), tested, and the test verified
  by fault injection. **Also corrected after Edward read the screen:** the panel said the response
  time is measured from confirmation, which contradicts d.5 — the code was right, the sentence was
  not, and it now states that the clock runs from the timestamp in the image and that a receipt can
  already be in exception when it is entered.
- [ ] ⚠️ `I35.6` **PARKED (Edward, 3 Sep) pending the leadership answer on verbal briefs.** The T+ exception, on read. A campaign whose brief has not reached `approved` within
  the threshold of its confirmed `received_at` is in exception — **wall-clock hours** (Edward's
  choice, recorded in ADR-0066 as a deliberate departure from the working-hours precedent, weekend
  consequence accepted). Threshold is a **tenant setting on the Admin → Reminders screen `I14.7` is
  already building**, default 24, beside chase-after and escalate-after; **do not hard-code it**.
  Surfaces: the campaign page, the campaigns list, and a panel on the dashboard beside
  `UnassignedWork` behind `health:view`. **Computed by query, not by a sweep** (d.9) — notifying
  anyone waits for `stall-sweep` and is explicitly out of scope. **Evidence is optional and an
  unevidenced campaign is NEVER in breach; nothing else about it is displayed** until the leadership
  question on verbal briefs comes back (d.10) — the implementation must not assume an answer.
  **Parked deliberately, not merely unfinished:** the table and `tenant_reminder_settings.brief_
  approval_hours` are applied and inert, so nothing yet tells anybody a brief has gone past T+1 —
  which is the half of ADR-0066 somebody would act on. Resuming needs only the answer to d.10.
- [x] `I35.7` 🔒 **`media_records` learns the filename it was always given.** One nullable column
  (`20260903100000`); `version` was already stored and already unique per deliverable. `review-media`
  now reads both and names the download `Harmony Brief v3.pdf` — original name, version before the
  extension so the file still opens in the right application. **Nullable deliberately**: rows written
  before the column genuinely do not know their name, and there is nowhere to backfill it FROM except
  the object key. Writing a sanitised guess into a column meaning *the name the person uploaded*
  would make every old row indistinguishable from a real one, so null means *this predates the
  column*, the signer falls back to `nameFromObjectKey`, and the difference stays visible. Six new
  tests on `versionedName`, including the one that says why it exists — two rounds of one file must
  not produce two identical names, because the browser resolves that by silently appending `(1)` on
  the one surface whose whole job is telling rounds apart.
- [x] `I35.8` **One folder picker, used three times.** The tree was written inline inside
  `LibraryPage` and its queries lived in `library-api`, so the wizard would have had to reach into
  another feature's internals (`AGENTS.md` §3). Split in two: the QUERIES to
  `lib/assets/folders.ts`, beside `upload-asset.ts` which is shared for the same reason (ADR-0044
  §8); the UI to `components/FolderPicker.tsx`, which fetches nothing, because a shared component
  is a UI primitive. **`rootId` is a FENCE, not a starting point** — the headline property.
  Navigation cannot go above it, so a campaign's reference material cannot be filed into ANOTHER
  campaign by clicking up the breadcrumb, and a stale position outside the fence falls back to the
  root rather than rendering somebody else's folders. Both are tested against a sibling campaign in
  the same client, because that is the leak that would actually happen. The Library's delete control
  stays in the Library, passed down as a **render prop**: arming a confirmation and knowing a system
  folder cannot be removed are its business, and baking them in here is how a shared primitive stops
  being one. Folder creation needs **no new grant** — `assets:manage`, the same as uploading, so
  anyone who can put a file somewhere can make somewhere to put it. A duplicate sibling name
  (`uq_asset_folders_sibling`) reads as a sentence, EN + AR. 9 new tests; the Library's own 5 still
  pass against the shared component.

**Open inside `I35`, carried deliberately:**

- ⚠️ **How an unevidenced campaign is treated** — Edward is confirming with leadership how **verbal
  briefs** should be handled. ADR-0066 d.10 decides only what is safe now (optional; never a breach)
  and records the incentive problem: *if evidence is optional and evidence starts the clock, skipping
  the screenshot is a way to never be late.* The likely fit is treating a verbal brief as evidence of
  a different kind — logged by a named person, at a stated time, on their word — which starts
  the clock honestly and costs one control rather than a new mechanism.
- **Images and residency.** ADR-0066 does not reopen ADR-0044 d.6 / ADR-0049 d.6, but it does mean
  that when residency is answered, **images must be considered separately from text** — an
  untrimmed screenshot is materially broader than a brief document, and incidental rather than chosen.
- **The per-image token rate for `gpt-5.6-luna` is not recorded anywhere.** ADR-0066's ~$0.0005 uses
  OpenAI's standard image tokenisation and is an estimate; the real number folds into `I34.5`.

---

### I36 — Cancelling is recoverable, and a task says what it is waiting for (ADR-0068 + ADR-0069, accepted)
> Edward, 3 Sep, from live use. **(a)** Cancelling a task warns nobody and cannot be undone — a live
> task was mis-cancelled on 2 Sep and recovered only by hand-written SQL. **(b)** Nothing expresses
> that one task needs another's output, so an approved task passes to nobody. The second turned out
> to be a **surface** gap: `sub_task_dependencies` and `deliverable_pending_inputs` were built in
> August under ADR-0030 and **the frontend has never referenced either**.
- [x] `I36.1` **Cancelling a task is confirmed, and the confirmation says what it costs** (ADR-0068
  d.1–d.3). Both surfaces — `/schedule`'s edit dialog AND `/deliverables`, which has the same
  single-click cancel and is the reason this is not a schedule-specific fix. The dialog names the
  **assignee, the dates and how many bookings will be released**; "are you sure?" is a click-through.
  **Deleting a PLAN gets its own, lighter wording** and is distinguished BEFORE the click by the same
  predicate `remove_sub_task` uses (unassigned · `todo` · never worked on, ADR-0052 d.10), so the
  dialog cannot promise one outcome and deliver the other. **Both surfaces were wired, and the schedule one was nearly missed** — it is the surface
  Edward actually reported, and the first pass did only `/deliverables`; he caught it.
  `EditBookingDialog` now arms the same dialog and has its own suite (the component had none).
  **No Reinstate control on the schedule**, deliberately: cancelling deletes the bookings, so the
  task leaves the calendar and there is nothing there to reinstate FROM — it is offered on the
  deliverable, where the task still is. House `NoticeDialog`, not `window.confirm`
  — the two `window.confirm` calls already in `DeliverablesPage` are their own tidy-up, not this one.
- [x] `I36.2` 🔒 **A cancelled task can be reinstated** (ADR-0068 d.4–d.7). New `sub_task_reinstate`:
  `cancelled → todo`, same authority as cancelling (`project_tasks:manage` + write scope), refused on
  anything not `cancelled`, and `done` stays uncancellable. **It does NOT recreate the bookings, and
  the surface says so** — the task returns unassigned and unscheduled, because capacity may since
  have gone to somebody else and quietly re-taking it is the invisible change ADR-0061 exists to
  stop. Notifies whoever lost the work. Paired pgTAP: the guard, the authority, and that bookings
  stay gone.
- [x] `I36.3` 🔒 **A dependency is satisfied on APPROVE, not on submit** (ADR-0069 d.2 — the one
  amendment to ADR-0030 §1b). One clause in `app.sub_task_has_unmet_prereqs`: `done` satisfies,
  `review` no longer does, `cancelled` still does — a prerequisite that will never happen must not
  hold its dependent for ever. **Everything else in §1b is reaffirmed and must not drift**:
  dependencies stay SOFT, Start is never disabled, and `started_ahead` keeps working (Edward, 3 Sep,
  after being reminded of the original reasoning).
- [x] `I36.4` **The `Required input` column, reading the LIVE task list** (ADR-0069 d.5, d.6). On the
  department deliverables surface. The picker reads **`sub_tasks` for the deliverable, never
  `workflow_steps`** — `workflow_step_id` is nullable and `on delete set null` and the title lives on
  the task, so a template-built picker would offer steps that no longer exist and omit tasks that do.
  **One column covers both kinds** (tasks waited on, and the deliverable's outstanding external
  inputs), because they are one question. Cross-deliverable and cross-department, which is the case
  that makes this worth building. The existing cycle guard's refusal must read as a sentence.
- [x] `I36.5` **External inputs get a surface, and approval tells whoever was waiting** (ADR-0069
  d.4, d.7–d.9). `deliverable_pending_inputs` has existed since August with **no way to register one,
  clear one, or see one**. Registered on the DELIVERABLE and cascading to its tasks — one *"waiting
  on Acme's logo pack"*, not six copies; `description` stays mandatory (ADR-0030 refused a vague
  "blocked" and that refusal is the point of the field); `awaited_from` stays **free text** (Edward:
  "the client's agency" is a real answer no dropdown would hold). Clearing one is an explicit act,
  stamped — which is what makes *how long were we waiting* answerable at all. **Approving a task
  notifies every assignee whose LAST unmet requirement has just cleared** — one message for three
  prerequisites, not three (ADR-0045's standing noise warning).

**Built 3 Sep; the three migrations are PREPARED, NOT APPLIED** — `20260903110000` (reinstate),
`20260903110100` (satisfied-on-approve + the notify trigger), `20260903110200` (submit stops
pinging). `supabase db push` + `gen types` are Edward's actions.

- **A correction to ADR-0069's Context, found while building.** That ADR says nothing emits a "your
  input has landed" event. **Wrong** — `app.sub_task_submit` has emitted `dependency_ready` since
  ADR-0030 (I8.4), on SUBMIT. The decision is unaffected (d.4 still puts it at approval); it is a
  MOVE, not an addition. Worse, after d.2 the old block **cannot fire at all**: its guard re-checks
  the requirements immediately after the prerequisite reaches `review`, which no longer satisfies,
  so the insert selects nothing for ever. Removed in `20260903110200` rather than left as dead code
  whose comment claims to be "the payoff of the dep model". **The ADR's Context needs the same
  correction as a dated note** — the decision stands, the premise was partly wrong.
- **An existing pgTAP suite encoded the OLD rule.** `030_task_notifications` asserted *"submitting a
  prerequisite pings the downstream owner"* — correct under ADR-0030, wrong under d.2. It now proves
  **both** halves: silence at submit, one ping at approve. A test that only checked the ping would
  have passed on an implementation that sent it at both moments.
- **The notification fires from a TRIGGER on the status reaching `done`**, not from
  `sub_task_approve`: `app.maybe_complete_sub_task` also completes a task (the appointment-change
  path), so hanging it off one function would have been a silent gap. It also avoids reproducing a
  90-line function whole, which the house `create or replace` pattern would otherwise demand.
- **Cancelling a prerequisite also frees its dependents and deliberately does NOT notify** — d.4 is
  about approval. One line to add if that turns out to matter; flagged rather than assumed.
- 43 new unit tests (`RequiredInput` 12, `ExternalInputs` 9, cancel/reinstate 5, plus the api and
  component wiring), 18 new pgTAP assertions in `081_reinstate_and_dependencies.sql`.

**Two defects Edward found by using it, both fixed the same day:**

- **Ad-hoc work had none of this.** `DeliverableDetail` returns EARLY for ad-hoc deliverables
  (`streamId == null && campaignId == null`) and rendered only the review panel, the task's
  resources and chat — **no task table, so no cancel, no reinstate and no Required input** — on the
  tab holding most of this tenant's deliverables. Not caused by `I36`; true since that branch was
  written, and invisible because the suite had **no ad-hoc detail coverage at all**. Ad-hoc is
  exactly one task by design (ADR-0058 d.8), so it now gets those controls directly rather than a
  one-row table. Its requirement picker is scoped to the **CLIENT** rather than a campaign it does
  not have — a retouch waiting on that client's key visual is ordinary, and the client is wide
  enough to be useful while keeping the picker a list rather than a search problem. 4 tests,
  verified by fault injection.
- **The requirement picker offered every OTHER deliverable's tasks and none of its own.** The
  candidate query REPLACED the deliverable list with the sibling join's result instead of adding to
  it, so a deliverable's own tasks were present only if that join happened to return it — and a
  task waiting on the step before it is the commonest requirement there is. Now a union, which is
  the right shape regardless. The filtered embed (`deliverables?streams.campaign_id=eq.X`) was
  replaced with plain queries: it reads as a join but **fails as an EMPTY RESULT rather than an
  error** (traps.md), and an empty result there is indistinguishable from "this campaign has no
  other deliverables" — the best candidate for the root cause. The picker is now **grouped**
  (*This deliverable*, then one group per other deliverable), because the two kinds were previously
  told apart only by a `·` prefix, which is exactly why a missing group was invisible.

- **Ad-hoc cancellation is FINAL, and that is a decision rather than a gap** (ADR-0068, amended
  3 Sep). Cancelling ad-hoc work archives the job it is (ADR-0061 d.6) and `archived` is terminal
  (ADR-0024), so reinstating the task alone produced live work under a dead container — silently.
  Edward ruled against amending the state machine, since **ad-hoc assignment is being retired**:
  `sub_task_reinstate` now REFUSES it (`20260903120000`, in the database rather than only on the
  screen — an RPC is a front door), and both dialogs say *"cannot be reinstated"* instead of
  offering an undo that does not exist. Campaign work is unaffected.

**Not in scope, and named so it is not rediscovered:** auto-scheduling a dependent task when its
prerequisite completes (collides with capacity, leave and the working week — belongs with the
scheduler); deliverable-level dependencies (derivable from tasks, and two mechanisms for one idea is
how they drift); and un-deleting a removed PLAN, whose row is gone.

---

### I37 — A department brief is approved by the department (ADR-0070, accepted)
> Edward, 3 Sep. The account manager approves the campaign; each department's brief is then
> DELIVERED to its leads, who approve it, and only then can that deliverable's tasks be assigned.
> A second gate in front of all campaign work — deliberate, and the reason the approver set is wide
> and the failsafe is explicit.
- [x] `I37.1` 🔒 **The approval, and the permission that is not `projects:manage`.**
  `campaign_briefs` gains `approved_at` + `approved_by` (d.1) — unapproved is the ABSENCE of a
  timestamp, as `campaigns.approved_at` already does it, so there is no parallel status column to
  keep in step. New **`briefs:approve`** in the permission catalog, seeded to `department_lead`,
  `team_lead`, `power_admin` and `scheduler` (d.2). `approved_by` is **stamped from `auth.uid()`**
  by a trigger, never taken from the payload — it is the column an argument about who accepted a
  brief would turn on. Paired pgTAP: a lead approves their own department and not another's; a
  Traffic Manager approves any (the failsafe); an account manager holding only `projects:manage`
  cannot approve what they wrote.
- [x] `I37.2` 🔒 **The gate, reading the DELIVERABLE's department.** `app.tg_sub_task_assignment_gate`
  gains a second condition beside `app.campaign_is_approved`. **Not the task's own department** —
  `sub_tasks.department_id` is stamped from the assignee (ADR-0050 d.2), so a Creative deliverable
  with a Production step would otherwise be gated by a brief that has nothing to do with it. One
  deliverable, one brief (d.4). **A missing brief does NOT block** (d.5): generation is on demand,
  and a gate that refused work until a brief existed would stop a campaign nobody had generated
  briefs for, with no signal saying why. Assignment only — creating, renaming and re-dating stay
  open, because that is what preparing work is.
- [x] `I37.3` ⚙️ **Delivery.** Approving the campaign notifies each department's leads — **in-app and
  email** (Edward) — naming the campaign and the department, linking to the brief, and saying that
  work cannot start until they approve. New notification type; **it needs COPY in `notify-email` or
  it is silently in-app only**, the failure that constraint's own comment records having produced
  six times. **Not sent to Power Admin or Traffic Manager** (d.6): they can approve anything and
  would receive every brief in the agency — the failsafe is a capability, not a queue.
- [x] `I37.4` **The exception: briefs awaiting approval.** On the dashboard beside `UnassignedWork`
  behind `health:view`, and on the campaign page against the department it belongs to. **No clock**
  (d.9) — a list of what is outstanding, not a judgement about lateness. Lists a department with
  **no possible approver** distinctly, because that one cannot be fixed by waiting and is the exact
  shape of the 29 August deadlock.
- [x] `I37.5` **The approve control**, on the campaign page's department section, visible to whoever
  may actually use it. Approval is **forward-only** (d.8): no un-approve, because ADR-0048 d.9
  already refused a changes-requested state on the grounds that the approver is the corrector.
  Editing an approved brief stays allowed and does not revoke the approval; the audit records both.

- [x] ⚠️ **An Account Manager could never create a campaign — found live, 3 Sep, and fixed in two
  steps.** `campaigns_tenant_write` applied `in_write_scope(null, null, campaign_account_manager(id))`
  to every operation, and that function looks the campaign up BY ID — so on an INSERT it resolved to
  NULL, and an account-scoped caller needs a non-null match. **No Account Manager had ever been able
  to create a campaign**; tenant-scoped roles return true unconditionally, which is why it went
  unreported for three weeks — Power Admin created them. ADR-0067 is why it surfaced: the INSERT
  moved from submit to leaving step 1, so a refusal that used to arrive after five steps of typing
  arrived at once and read as *"it will not let me continue"*.
  `20260903140000` read the AM from the row being written; that was necessary and not sufficient,
  because `in_write_scope` for `account` is `p_account_manager = auth.uid()` and the person raising
  the brief was **not the client's AM**. **⚠️ Edward then widened it deliberately** (3 Sep: *"anyone
  with project:manage can create, edit and delete… we have audit tracking anyway"*), so
  `20260903150000` makes the PERMISSION govern campaign and stream writes and drops the
  account-scoping `20260812130000` added. **STREAMS had to move too**: the wizard writes a
  campaign's one stream in the same call, so a stricter rule there would only have moved the refusal
  to submit. `jobs` keeps its scope — ad-hoc work, nobody reported it, not swept along.
  **⚠️ This changes an authorization boundary and has no ADR yet.** The reasoning is in the
  migration header in full; it wants a decision record, and that is the one thing left outstanding
  — **partly closed 15 Sep: ADR-0083 addendum d.13 records the rule for CAPTURE (campaign, stream,
  receipt: `projects:manage`, audit is the control) after the receipts table, a verbatim copy of
  the OLD rule, refused a real user (`I48.38`). The campaign/stream half still has no ADR of its own.**
  from 3 Sep.

**Named so it is not rediscovered:** a T+ threshold on department approval (d.9 — anticipated,
undecided); an un-approve path (d.8); and escalation when a brief sits unapproved, which belongs to
ADR-0045's `stall-sweep` and is still unbuilt (`I14.7`).

---

### I38 — A brief orders its own work, and quantity multiplies the creation step (ADR-0071, accepted)
> Edward, 5 Sep, from the scope table in `docs/reference/CampaignTypeTables.xlsx` and the mapping
> worked through and accepted in `docs/reference/DRAFT_Taxonomy_Brief_Workflow_Mapping.xlsx`.
> Two rules written on 28 Aug and never built — quantity produces no tasks, and workflow was
> attached by CATEGORY when the column is per TYPE — plus a third nobody had named: nothing said
> which brief may order which work. **Nothing here re-materialises an existing deliverable** (d.12);
> the two live campaigns are protected by a test, not by care (d.14).

- [x] `I38.1` 🔒 **The mapping table.** `brief_deliverable_types (tenant_id, brief_type,
  deliverable_type_id)` with RLS enabled and forced in the same migration — tenant-wide select
  (a picker that cannot read its list cannot render), writes under `organization:manage`, no new
  permission (d.1). `brief_type` is **text, not a foreign key** to `brief_templates`: deleting a
  brief template must not take deliverable types with it. Seeded from the accepted mapping sheet.
  Paired pgTAP: a member of another tenant reads none of these rows; a user without
  `organization:manage` cannot write one.
- [x] `I38.2` **The picker SORTS, it never restricts** (d.1). The brief's own types first,
  everything else still reachable below. A hard limit would turn every gap in a judgement about an
  agency into a person unable to work at 5pm — and it means the mapping can be wrong in production
  without blocking anyone. Role-leakage test unchanged.
- [x] `I38.3` **Nine deactivations, zero deletions** (d.2). Six resolve duplicate names open since
  29 Aug (Reel, Short-form Video, Long-form Video, Social Advertisement, Print Advertisement,
  Billboard — one of each pair kept); three are `STR-001`, `STR-003`, `STR-004`, which no brief
  orders. **Checked, not assumed:** the wizard filters the picker on `isActive`
  (`BriefWizard.tsx:471`) while `deliverables-api.ts:146` reads the type name through a LEFT embed
  with no active filter, so a live deliverable on a deactivated type still renders.
- [x] `I38.4` 🔒 **`brief_templates` gains `digital_build`** — 13 fields, EN + AR, ten required
  (d.4). Website, Microsite, App Design, UI and UX were ordered by nothing. **Blocked on the Arabic
  review** (see `I38.10`).
- [x] `I38.5` 🔒 **Five new templates and one revision** (d.5): `WF-15` Influencer Engagement,
  `WF-16` Creator Content, `WF-17` Media & Performance, `WF-18` Event / Activation, `WF-19`
  Strategy Document, `WF-20` Digital Build; `WF-07` revised so the 17 BRAND IDENTITY types are its
  components rather than 17 deliverables (d.3). Every step derived from the agency's own brief
  templates, field by field. Seeded idempotently (`on conflict do nothing`), folded into
  `public.seed_tenant_roles`.
- [x] `I38.6` 🔒 **Creative Direction first, Develop Concept second** (d.6). Creative Direction
  existed in **one** template of fourteen. Added to 13 existing + 3 new; Develop Concept added
  where missing (8). Never a repeating step — one direction covers all six reels. Three exceptions,
  confirmed by Edward: Branding takes it AFTER Strategy; Media & Performance and Strategy Document
  do not take it at all.
- [x] `I38.7` 🔒 **Steps renamed so the creation step is obvious** (d.7). `Copy/Content` →
  `Write Copy`; `Creative` → `Create Content`; `Design` → `Create Artwork`. **The rename touches
  only rows the seed still owns** — matched on template `code` AND exact current `title_en`,
  `is_system` only — the guard `20260829140000` used, reused verbatim. A step a tenant has renamed
  is left alone.
- [x] `I38.8` 🔒 **Quantity multiplies the creation step** (d.8, d.9) — the point of the whole task.
  `workflow_steps.repeats_per_unit boolean not null default false`; `sub_tasks.unit_index integer
  null`; `app.materialise_deliverable_workflow` creates `quantity` tasks for a repeating step and
  one for every other. **Creates `uq_sub_tasks_workflow_step_unit` — the unique index ADR-0052 d.4
  specified and which was NEVER CREATED**; only the non-unique `idx_sub_tasks_workflow_step_id`
  exists (`20260828190000:124`), so "never duplicates" has been held by application code alone
  since 28 Aug. It is what makes re-running materialisation idempotent once a step makes six rows.
  The convention — exactly one repeating step, and it is the creation step — is **documented, not
  constrained**: WF-15 repeats five steps because its quantity is CREATORS, and WF-07R/WF-19 repeat
  none because theirs is always 1.
- [x] `I38.9` **Task titles composed at creation** (d.10): `Create Artwork — Instagram Reel 3`. The
  template still never names a deliverable, so a template edited later still cannot rename work
  already issued (ADR-0052 d.14 / ADR-0059 d.3).
- [x] `I38.10` **The Arabic.** 128 new and renamed strings drafted on the workbook's `Arabic` sheet,
  register matched to the 28 Aug seed and its wording reused verbatim where the concept is
  unchanged. **Awaiting the agency's own reviewer** — Edward, 5 Sep: *"Include the Arabic we will
  have it checked."* `I38.4`, `I38.5` and `I38.7` land bilingual, not English-only, so this does
  not repeat the ADR-0051 d.6 debt. One flagged for the reviewer specifically: `Mix Sound`, where
  the seed's معالجة الصوت reads closer to "audio treatment".
- [x] `I38.11` **Unassigned work is reported by campaign, with a drill-down** (d.13). Today the tile
  caps at 50 rows and renders `rows.length` as the count, so 200 unassigned tasks report as **50**,
  and the "and N more" line is wrong by the same amount. Grouped **server-side** in a
  `security invoker` view so RLS decides visibility and the browser never fetches hundreds of rows
  to count them. **No ad-hoc row**: `create_adhoc_deliverable` refuses a null assignee
  (`20260820010000:35`), so unassigned work is campaign work by construction.
- [x] `I38.12` 🔒 **The two live campaigns are a test, not a hope** (d.14). pgTAP captures both
  campaigns' task lists — id, title, `sort_order`, `review_mode`, status, assignee — and asserts
  they are byte-identical across the migration. If a rename or a reseed touches live work the suite
  fails rather than production.

**Named so it is not rediscovered:** whether the mapping should ever harden from a sort into a
restriction, and whether a department brief should carry its own deliverable-type list separately
from the campaign brief. Bulk assignment and bulk cancel have their own entry — **I39**.

---

### I40 — Step 5 becomes Review & Approve, and the briefs are tabs
> **Frames reviewed and reworked with Edward through 5 Sep.** He walked every frame, corrected the
> flow repeatedly, and the wizard frames are now the approved set — *"the only approved frames thus
> far are the campaign wizard frames"*. Gated by **ADR-0072** (accepted 5 Sep), which fixes the
> generation permission this work depends on. This entry exists because
> the work was never recorded at all. Eleven Brief Wizard
> frames were drawn in `E2EV1.pen` on 4 Sep: `01`–`05` mirroring the implementation exactly (Edward:
> *"the running application in the browser is the source of truth… do NOT redesign"*), `06` the
> approval page as it is today, `07` approval straight out of the wizard, and four PROPOSED frames
> for the combined step. They were committed inside `b7dc35c` with a message that does not mention
> them, and nothing in this tracker pointed at them. Edward, 5 Sep: *"we spent considerable time on
> the pen file trying to correct the UI and you did not record any of this."*

**What is wrong today.** Edward, 4 Sep: *"the review page is very sparse and is not accurate; the
page after step 5 actually contains all items that are intended for review and edit prior to
approval… I would suggest step 5 and the subsequent approval step be combined."* And on the shape:
*"the campaign brief and individual dept briefs should display as tabs, not all on one page. If we
adopt this approach the step 7 frame should not be required."*

**Edward's direction, quoted above, is what binds.** Below is how the four PROPOSED frames render
it — **my proposal, awaiting his review**. Everything not traceable to a quote above is mine:

- Step 5 is renamed **Review & Approve** in the rail; there is no separate approval page after it.
- A **campaign identity** header — name, client · brand, the Account Manager.
- Two **gauges**: *Deliverables done* and *Tasks assigned* (`0/3`, `2/9`).
- **State A — before the department briefs are written.** A block naming each department that has
  none and the template it would use, and one primary action: **Write the department briefs**.
  **No Approve button exists in this state** — Edward, 4 Sep: *"the Approve Campaign button is not
  displayed until the department briefs are generated."*
- **State B — written, awaiting approval.** *"Waiting for you to approve. Nothing here can be
  assigned or booked until you do"* — which is ADR-0048 d.8's gate, said out loud where it bites.
- **A tab row, not one long page**: `Campaign brief` · one tab per department, each marked when its
  brief is unapproved · `All deliverables`.
- The campaign-brief tab renders the nine strategy fields as term/definition pairs.

- [x] `I40.0` **Show Edward the frames and get a yes or a correction.** Done 5 Sep. He reworked them
  substantially: A and B merged (the AM never generates a department brief, so "before the briefs are
  written" is not a state the AM can act on), the department tab shows EMPTY brief boxes with the
  instruction, and every tab gained a real forward action.
- [x] `I40.A` **Design system adopted as the app's palette.** `src/index.css` token block replaced
  from `00 · Design system`. Nine values moved; new `--sidebar` (fixed dark — `--ink` is a TEXT
  colour that inverts), `--divider-on-dark`, `--row-tint`, `--radius-card`; `--accent-strong` given
  a real value, having been an alias of the base so "strong" rendered identically. Also fixed five
  colours drawn from **undefined tokens** (`--danger`, `--ok`, `--warning-text`), whose fallbacks
  were a pre-violet palette — every error and success dialog in the product was using them.
- [x] `I40.B` **`NoticeBox`** + `.notice-box`, `.tab-dot`, `.tab-row-legend`, `.brief-panel*`,
  `.receipt-input`, `.brief-receipt`. Most of what the frames depict already existed (`.tab-row`,
  `.gauge-ring`, `.wizard-steps`, `.library-folder-card`) because the frames were drawn FROM the app.
- [x] `I40.C` **Steps 1–4** — guidance boxed (Edward: *"they appear not to read the text if it is not
  highlighted"*), copy updated EN + AR at full key parity, step 2's raw browser file control replaced,
  the paste target made a visible box.
- [x] `I40.1` **Merge the approval page into step 5** and rename the rail entry. Step 5 both submits
  and approves in one action, and `stepValid(1)` now requires the account manager, so the approver
  is named before the approval is asked for.
- [x] `I40.2` **The tab row** — campaign brief, one per department **that requires a brief**, all
  deliverables. Tabs are DYNAMIC (Edward: *"additional depts may be added in the future"*). An
  unapproved department brief is marked, with a legend saying what the mark means.
- [x] `I40.3` **The department tab** — the instruction, the empty brief state, and `Generate the
  brief` disabled WITH its reason rather than hidden (ADR-0072 d.3: no department brief before the
  campaign is approved, and at step 5 it is still a draft), plus that department's deliverables.
  **The task list is deliberately not here.** Its columns — order · Task · Owner · SLA · Due ·
  Status · Review · Required input (ADR-0069) · Resources (ADR-0042) · Edit · Cancel · Remove —
  describe tasks, and a draft campaign has none: they are generated from the department brief, which
  cannot exist until after this step approves the campaign. That list lives on the campaign surface,
  where the work it describes actually exists.
- [ ] `I40.4` **The two gauges** — deliverables done, and assignable-after-approval reading `0`,
  because nothing is assignable before the gate opens.
- [x] `I40.5` **Delete the separate approval page** — nothing to delete. There never was a
  standalone one: approval lived on `CampaignPage`, the campaign detail surface, *"because approving
  a campaign means reading it"* (ADR-0048 d.9). That page stays, and stays the place a
  `brief_awaiting_approval` notification leads to. Checked against `src/app/router.tsx` rather than
  assumed.
- [x] `I40.6` **The authorization migrations** (ADR-0072 + ADR-0073). Five files, all verified
  against a throwaway Postgres via `scripts/db/verify.sh` — 89 files, 988 assertions, PASS.
  `account_director` seeded (grants COPIED from the Account Manager so they cannot drift, plus
  `briefs:approve`); `app.in_write_scope` gains the all-accounts branch — the one place a role key
  is read, deliberately inside the primitive; `app.approve_campaign` rewritten onto grant + scope,
  which is what unblocked Edward; the provisioning wrapper extended so new tenants get the role; and
  `public.may_generate_department_brief` as the doorway `generate-brief` calls instead of
  assembling grant + scope + status itself (ADR-0037). New pgTAP: `087` (13) and `088` (9).
  **`059` corrected, not patched** — it used the Scheduler as its "cannot approve" subject and they
  now can, which is the failsafe working; the assertion moved to a team member holding neither the
  grant nor the scope.
- [x] `I40.7` **Responsive** — `.data-table.is-stacked`: below 768px every row becomes a card and
  each cell carries its column name via `data-label`, so a value is never nameless. Applied to all
  three wizard tables. The tab row scrolls rather than wrapping, and the legend renders a second
  time below it — a legend inside a scrolling row scrolls out of sight, and the dot must never be
  the only signal.
- [x] `I40.8` **Account manager required at step 1** (ADR-0073 d.5), marked `*` like every other
  required field. A campaign with nobody named leans entirely on the failsafe.

- [x] `I40.9` **The department writes its own brief** — `generate-brief`'s FIRST call site in the
  product. It and its hook had existed since 27 August with nothing invoking either, which is why
  every campaign read *"this department's brief has not been written yet"* for ever with no way to
  change it, and why the permission mismatch ADR-0072 found had never met a real user. Where the
  empty state was one muted sentence there is now the instruction, the consequence, and the button —
  on `CampaignPage`, which is where the `brief_awaiting_approval` notification leads. The
  campaign-wide sweep stays for the account manager; this is the department's own half, sharing one
  template resolver so the two cannot disagree about which template a department writes from. The
  three refusals map to three sentences (ADR-0072): a lead who is merely EARLY is never told they
  lack permission. No template assigned keeps the instruction and drops the button — a configuration
  gap, not a refusal.

- [x] `I40.10` **What Edward's own pass through step 5 found.** Six defects, all live, all found by
  using the thing rather than by reading it. Recorded because each one had passed every gate:

  1. **"No leads assigned"** where every deliverable had an owner. The message blamed staffing for a
     missing brief TEMPLATE. Departments with no template are now named as a configuration gap.
  2. **The screenshot was never read back** onto step 1. It was filed correctly and simply never
     fetched, so a resumed brief looked as though the evidence had been lost.
  3. **The fields confirmed against it were hidden** behind `{value.image && …}` — a gate on the
     in-memory file, which a resumed brief does not have. Fixed to accept the FILED image too.
  4. **`receivedAt.split('T')` returned UTC.** A brief received 14:32 in Baghdad read back 11:32,
     and near midnight the DATE moved as well. Replaced by `wallClockIn`, the true inverse of
     `instantFrom` — the reading a person confirmed is the one inside the image (ADR-0066 d.5).
  5. **Brief approvers named the DEPARTMENT.** "CREATIVE" cannot approve anything. Now the people,
     by name, with the department as the qualifier because one person may lead more than one.
  6. **A resumed draft opened blank from step 2.** The one below, which needed a migration.

- [x] `I40.11` **A draft keeps the brief that was written into it.** ADR-0067 promises drafts are
  *"resumable — a capability the old design could not offer"*; half of it was built. Brand, name and
  account manager were saved on leaving step 1, and everything typed on steps 2 to 4 lived in React
  state until submit — so a resumed draft restored step 1 and showed four empty steps, with nothing
  to distinguish it from a fresh one. Edward, 5 Sep: *"all the data is missing… the form is blank."*
  `20260905200000` gives `update_campaign_draft` a `p_brief` and a `p_go_live`, both defaulting null
  and both `coalesce`d — **null means leave alone, not blank**, which is what lets step 1 keep its
  existing four-argument call and makes going BACK to step 1 safe. Nothing new is stored:
  `campaigns.brief` is the column submit was always going to write, and `briefPayload` already
  nested the deliverables inside it, so steps 3 and 4 round-trip with no relational change and the
  deliverable ROWS are still written exactly once, at submit. A failed save no longer advances the
  step — the wizard never claims to have kept what it dropped. Seven pgTAP assertions, five of them
  guarding the leave-alone half, plus five wizard tests including a pre-I40 draft with no brief.

- [x] `I40.12` **The approver list stopped guessing.** Naming people instead of departments (I40.10
  item 5) fixed one complaint and caused the next: *"it shows the brief approvers as the assigned
  owner, the Department Lead and 2 other team leaders and a team member for the same department."*
  Both faults had the same cause — a role list written in the CLIENT
  (`['department_lead','team_lead','deputy_team_lead']`), which is the mistake ADR-0072 exists to
  settle. It could not see an ADR-0036 per-user grant, the documented way to appoint a stand-in, and
  it mistook being IN a department for being in scope of it. `20260905210000` adds
  `department_brief_approvers(campaign)`, answering from grants and scope the way the refusal does:
  the department's own lead, plus **whoever this campaign assigned the work to**. The first attempt
  read "assigned" as the TEAM, which is the same mistake one step smaller — it still listed a lead
  whose colleague was assigned. Edward, 5 Sep: *"the only approvers named should have been the
  person assigned and the department lead."* An assigned owner who does not hold `briefs:approve` is
  not named either: a list must never promise somebody the RPC would refuse. The failsafe needs no
  exclusion
  written for it, because `tenant` and `account` scope simply do not match a department; that is
  ADR-0070 d.3's argument holding a second time. It reads a DRAFT's owners out of `campaigns.brief`
  (I40.11) as well as the `deliverables` table, because step 5 runs before those rows exist. Twelve
  pgTAP assertions, two of them proving `app.user_has_permission` and `app.has_permission` never
  disagree about the same person — the drift that would let the screen name somebody the RPC refuses.

- [x] `I40.13` **A Team Leader can approve their own department's brief — which they could not.**
  Found while building I40.12, and it had to be settled first: a list naming somebody the RPC would
  refuse is worse than one naming a department. `approve_department_brief` asks
  `app.in_write_scope(department, null, null)`, and the `team` branch read
  `p_team is not null and p_team = current_team_id()` — false with no team named. So ADR-0070 d.3's
  plain sentence, *"A team lead may approve their own department's brief"*, was never true in the
  code, and `may_generate_department_brief` refused them for the same reason. Nothing caught it:
  test 082 exercises a Department Lead and the failsafe roles, never a team lead. The `team` branch
  now also answers a question asked with NO team, using the department that lead's team sits in.
  Every other call site passes a team alongside the department, so their behaviour is untouched, and
  a question that names a team still binds a lead to their own — asserted, because "as narrow as it
  claims" is the only thing that makes widening a scope primitive safe.

- [x] `I40.14` **The account manager could not accept a brief on their own campaign either.** Found
  by asserting the failsafe instead of assuming it, after Edward asked for it to be confirmed. Same
  fault as I40.13 one argument along: `approve_department_brief` passed `null` where
  `app.in_write_scope` expects the campaign's account manager, and an `account`-scoped person is
  matched by exactly that argument — so the `briefs:approve` grant on `account_manager`, added by
  ADR-0070 d.2's 3 Sep amendment (*"the account manager can approve their own brief, even if they
  created it"*), was unreachable from the day it was seeded. `may_generate_department_brief` already
  passed it, so a manager could be invited to generate a brief and then refused permission to accept
  it. Now the same call in both. **Confirmed still able to approve, each asserted as the RPC's own
  guard:** Power Admin, Traffic Manager, Account Director (ADR-0073 d.6), and the campaign's Account
  Manager — the last through the real function, since that is the only version that counts. None of
  them appear in the approver LIST, which is a display choice (d.6) and not a capability.

- [x] `I40.15` **The approver list stopped naming people a scope grant reached.** Edward, 6 Sep:
  *"it should name the assigned owner of the deliverables as the Brief Approver… It should not list
  the failsafe backup approvers. Currently it lists all account managers and all team leads as well
  as the dept lead."* Measured against the live tenant rather than guessed: several people hold a
  `user_scope_grants` row over CREATIVE and CONTENT — Account Managers, the Account Director,
  a Team Leader and a Team Member — and those holding `briefs:approve` were every extra name on
  his screen. I40.12 admitted them deliberately, as ADR-0036's stand-in for an absent lead; this
  tenant hands those grants out to widen scheduling reach instead, and reading "may write in
  Creative" as "answers for Creative's brief" is what put them under the heading. The branch is gone
  (`20260906100000`); the other two stand — the department's own lead, and whoever this campaign
  assigned the work to. **Nobody lost the ability to approve**: `approve_department_brief` is
  untouched, and being off the list is the same display choice ADR-0070 d.6 already makes for the
  agency-wide failsafe. The per-user PERMISSION overlay is still read, so an allow still names an
  assigned owner and a deny still removes them. Test `090` gains the inverse assertion — a lead
  given the department as a scope target is still not listed — at 18 assertions.

- [x] `I40.16` **The Account Director's reach is a setting, not its name in a function**
  (ADR-0074, accepted 6 Sep). Edward, 6 Sep: *"the description in the Account Director's role
  is incorrect."* The behaviour was already right — it reaches every account, an Account Manager only
  their own — but `roles.scope` had no value meaning that, so the role sat on `account` and the Roles
  screen showed it the Account Manager's sentence: *"Their own accounts — this role can act on the
  clients and campaigns the person is named on."* The extra reach lived in `app.in_write_scope` as
  `roles.key = 'account_director'`, the one exception to ADR-0073 d.2's own rule that no function may
  name a role. A sixth reach `all_accounts` replaces it, the Account Director is set to it, and the
  exception is deleted. **No behaviour changes** — checked, not assumed: the one other reader of
  `account` scope (`create_campaign_from_brief`'s manager stamp) was made an explicit parameter back
  in `20260829150000`. Three readers move together: the primitive, the reach ladder on the Roles
  screen, and the client mirror in `write-scope.ts`. Test `087` gains the two assertions that prove
  the name buys nothing — set the Account Director back to `account` and it is refused; set a
  Department Lead to `all_accounts` and it reaches an account it does not manage. `verify.sh` 91
  files / 1015 assertions, 1651 frontend tests, typecheck, lint. Migration
  `20260906110000` applied 6 Sep.

- [x] `I40.17` **A built-in role's name and description follow the interface language.** Edward,
  6 Sep: *"arabic is still displaying: Oversees every account — campaigns, clients and briefs across
  all of them."* Every role's words came from `roles.name` / `roles.description`, seeded in English,
  and every screen printed the stored string — the Roles screen, the header, the directory, the
  users list, the per-user permissions dialog. Nothing was broken; there was nowhere for the Arabic
  to live. The thirteen seeded roles are the same in every tenant and what they mean does not vary
  by agency, so their words are **copy**, and copy lives in `src/locales`
  (`admin.roles.catalog.<key>.name` / `.description`, both languages). A role an administrator
  creates keeps printing exactly as stored. `src/lib/roles/role-text.ts` holds the one rule.
  **Consequence, deliberate:** a built-in role's name and description can no longer be edited on the
  Roles screen — a stored rename and a translation cannot both be right, and the stored one would
  read correctly in one language only. Reach, landing page and grants stay editable; a tenant
  wanting its own wording creates a role. Six tests: the two languages must both exist and must
  differ, the row's word loses to the app's, a tenant role is untouched, and saving a built-in role
  sends its stored name and description back unchanged (the form no longer carries them, and reading
  them as `''` would have blanked the description of every built-in role on any other edit). No
  migration — this is text.

- [x] `I40.18` **The campaign page reads in tabs, like step 5.** Edward, 6 Sep: *"we spent a lot of
  time changing the layout wizard to display campaigns in tabs, campaign brief, dept briefs and
  deliverables, when i open the campaign by ID this layout is gone."* Correct — `ReviewStep` got the
  tab row and `/campaigns/:id` kept the stack it always had, so the same campaign was reviewed two
  different ways depending on which door you came in. `CampaignPage` now carries the same row:
  campaign brief, one tab per department section, all deliverables. The tabs are DATA — they come
  off `departmentSections`, so a department that gains work appears without anything enumerating
  departments — and the dot marking a department whose brief is not yet accepted is paired with the
  legend, colour never being the only signal. The `unassigned` bucket earns a tab like any other,
  which is what keeps ownerless work visible rather than last. The last tab is read-only: a
  deliverable is opened and edited inside its department's tab, next to the brief it came from.
  Six new tests; fifteen existing ones now open the tab they assert into, and the two that read two
  departments at once read them one after the other. 1664 frontend tests, typecheck, lint clean.

- [x] `I40.19` **A department has a DEFAULT brief, so an ordinary campaign asks nobody.** Edward,
  6 Sep: *"before all these changes were made, selecting a campaign was automatic… what changed that
  the system cannot intelligently match the brief required on the basis of the deliverables? this was
  working in early versions."* He is right that it was automatic, and the history says exactly what
  changed. `20260830210000` gave a department ONE template on `departments.brief_template_id` — one
  value, one answer, nobody asked. **Hours later** `20260830230000` dropped that column for the
  many-to-many table, because *"if I assign Creative Brief to Creative, I cannot assign any other
  brief to Creative"*, and the picker was the price. That same migration records the alternative
  being weighed and set aside: *"Edward chose this over writing every applicable brief, and over
  deriving it from the deliverable type — 'if we need to change it later we change it.'"* This is
  that change. **It was never derivation** — nothing has ever matched a brief to deliverables, and
  that is worth stating because it is the thing being remembered. Deriving it now was measured
  against the live tenant and refused: TEST CAMPAIGN 23's four Creative deliverables tie at one
  match each across three briefs, and the right answer scores zero because
  `brief_deliverable_types` files its 17 campaign rows under the reserved key `campaign_360` while
  the Creative Brief template's type is `360`. ADR-0071 d.1 says the mapping SORTS and never decides.
  So: `department_brief_templates.is_default`, one per department held by a partial unique index,
  set through `set_department_default_brief` (one transaction — the old default must go before the
  new one lands) on Admin → Brief templates. Backfilled where a department has exactly one template,
  which changes nothing; a department with several starts with none and asks until somebody ticks
  one. In this tenant that is **two ticks, Creative and Content**, and then never again. `verify.sh`
  92 files / 1024 assertions, 1673 frontend tests, typecheck, lint, `check:authz`. Migration `20260906120000` applied 6 Sep.

- [x] `I40.22` **`/deliverables` tracks the TASK, because the task is what was assigned.** Edward,
  8 Sep: *"the task assigned sits under the deliverable… we need to track each task as the task is
  what is actually assigned on the /schedule"*, and *"when a task is assigned it does not get marked
  started before the assignee selects start"*. The list showed the deliverable's stored STATE, which
  reads `in_progress` from the moment it exists — so work nobody had begun looked exactly like work
  under way, on the one screen whose job is to tell them apart.
  **Status derived from the tasks** (`lib/work-phase.ts`): Not started · In progress · In review ·
  Blocked · Complete, with `done of total` and the unassigned count beneath it.
  **Three people columns, because they answer three questions** — Edward pushed back on the first
  cut, which conflated them: **Owner** is accountable for the deliverable (ADR-0050) and may be
  doing none of the work; **Assigned to** is who is on the live tasks; **Waiting on (required)** is
  the MANDATORY reviewers outstanding on a task actually in review (*"they are the only ones that
  block the work"*). `lib/row-people.ts`, tested. My Work and Awaiting Review still name every
  reviewer — there the question is who is looking at your work, and an optional reviewer is an
  answer to it.
  **Column filters**, options derived from the rows so one can never offer a status nothing is in
  nor miss somebody who is on the work; the clear button appears only once something is narrowed.
  **Two things found on the way.** The Ad-hoc tab fetched no tasks at all, so every count on it was
  hard-zero and no status was derivable. And **there is no such thing as a blocked TASK** —
  `sub_tasks_status_check` admits only todo/in_progress/review/done/cancelled — despite a leftover
  `deliverables.subStatus.blocked` label saying otherwise; blocked is read from the DELIVERABLE.
  **Two corrections from Edward driving it (8 Sep).** (a) The reviewer column showed MANDATORY
  reviewers only, and `sub_task_reviewers.is_mandatory` DEFAULTS TO FALSE (ADR-0043 d.5) — so on
  real data it was blank on tasks that had genuinely been waiting a week. It now falls back to
  whoever IS outstanding, marked *(not required)*: "the UI never blocks — an empty narrowed list
  falls back to the full one". Renamed **Awaiting review by**, because "Waiting on (required)" did
  not read as the reviewer column. (b) **"Complete" meant two things on one row** — the badge
  counted TASKS while the Live/Complete grouping read the deliverable's STATE, so an unsigned-off
  deliverable read "Complete" inside the LIVE group. Complete is now the deliverable's own answer;
  every task done with no sign-off is **Awaiting sign-off**, in amber, which is a stall worth
  showing rather than rounding up to green. And **both tabs split now** (*"both ad-hoc and campaign
  should be the same"*): the campaign tab did not, on a "one campaign is a short list" argument that
  the pilot has outgrown.
  Read-side only, no migration.

- [x] `I40.23` **A container closes when its contents are done (ADR-0077, accepted 8 Sep).**
  ADR-0058 d.6 was decided 28 Aug and **never fired once**: the automatic sign-off was gated on the
  deliverable being `in_review`, and nothing in the system ever writes that state. Eleven ad-hoc
  deliverables sat with their only task done AND approved, container `in_progress`, unreachable from
  both directions — the Ad-hoc tab's row actions are filtered to Archive only, so there was no manual
  route either. `app.maybe_complete_sub_task` now accepts `in_progress`; the guard allows
  `in_progress → approved`; the 9 rows in `in_review` and the 11 stranded are corrected in the same
  migration. Cancelled-only deliverables are deliberately untouched (`I40.24`).
  **Two things the pgTAP suite caught that reasoning did not.** The first cut reproduced the guard's
  event block from `20260817110100` rather than the current `20260828210000`, using an
  `attribution_party` value that no longer exists — **nine suites and ~50 assertions failed on a bad
  enum cast**, which read as "this change is enormous" until the real cause surfaced. Exactly the
  trap `traps.md` describes. And the rollup path skipped the sign-off permission for ANY
  `in_progress → approved`, so a deliverable whose every task was **cancelled** could be closed by
  anyone who could reach it — `cancelled` counts as settled. Now requires at least one task actually
  approved (ADR-0077 d.3a).
- [ ] `I40.25` **Retire the container's review state and its buttons.** ADR-0077 d.3 left
  `in_review` reachable because **fifteen pgTAP suites drive it as setup**; removing the edge broke
  twelve of them. Nothing NEEDS it any more — a container reaches `approved` without it — so this is
  a cleanup, not a behaviour change: remove the edge, move any stragglers out, and take the
  review/approve buttons off the campaign tab, which is the "third path for the same process"
  Edward asked about (8 Sep). Until then the duplication is reduced, not gone.
- [ ] `I40.24` **What should a deliverable whose only task was CANCELLED read as?** Thirty-four of
  them on the live tenant. Not finished — nothing was ever approved — so ADR-0077 d.6 refuses to
  record them as approved.
  **Half done (8 Sep):** they read **"Work cancelled"** rather than "No tasks yet", which was a lie
  Edward caught — *"there is a filter for 'no task yet', how is that even possible on the ad-hoc
  list?"* It is not: the schedule creates an ad-hoc deliverable WITH its task. The phase was derived
  from a count that excluded cancelled tasks, so work that was called off reported as work that
  never existed.
  **Still open:** whether they should leave the live list. They are not outstanding work and nobody
  owes anything on them, but their state is `in_progress` and the Live/Complete split reads state.
  Archiving them is the obvious answer and it is Edward's call, not a default.
- [x] `I40.26` **Two things Edward found driving the real screens (8 Sep).**
  **(a) The actions cell was short against its own row.** `.row-actions` is `display: flex`, and on a
  `<td>` that takes the cell OUT of the table layout algorithm — it stops stretching to the row's
  height, so its background and borders came up short beside every other cell. Kept as a table-cell
  where it IS a cell, with the spacing moved onto the children; the `<div>` use of the same class is
  untouched.
  **(b) Ad-hoc work could not change who reviews it.** The campaign branch appoints reviewers when a
  task is created and the schedule's edit modal can change them afterwards. The ad-hoc panel had
  neither — on the tab holding most of this tenant's deliverables. A task cannot complete without its
  mandatory reviewers agreeing, so a reviewer named in error, or since departed, was a dead end.
  `ReviewerPicker` now sits with the requirements and resources, saving through `save_sub_task`,
  which coalesces everything it is not sent.
- [ ] `I40.21` **The campaigns list answers nothing worth asking.** Edward, 8 Sep: *"the columns do
  not provide any meaningful information… brief type and streams is irrelevant."* It shows name,
  client, brand, brief type, stream count and go-live — two of which nobody reads and none of which
  says whether the campaign is moving. Replace with: **campaign brief status** (approved / pending
  approval), the **account manager**, **department brief progress** counted rather than listed
  ("1 of 2 approved"), and the **brief owners** by name. Name, client and brand stay.
  **One view, not one query per row.** `department_brief_approvers` is per-campaign, so reading
  owners through it would be N+1 across the list. `security_invoker` view (precedent:
  `audit_event_entities`, `L1.23`) shaping the whole row server-side — it also sidesteps the
  PostgREST embed ambiguity that a four-level nested select would walk straight into, since
  `deliverables` reaches `user_profiles` by two different foreign keys.
- [x] `I40.20` **The brief the department will use is stated, and generating moved onto its tab.**
  Edward, 6 Sep, approving I40.19 with corrections. Four changes, all his words. **(a) The default is
  said out loud** — *"this brief will use the default xxx brief, use the dropdown if you would prefer
  a different briefing template"*. A default applied silently is the same silence in a better
  costume, so the tab states which brief it will write: the only one assigned, the default plus that
  sentence, or "choose one before generating" where a department has several and no default. A
  dropdown selection still overrides the default. **(b) The advisory names names** — it read
  *"1 department(s) on this campaign have no brief yet"*, a count that asks nothing of anyone. It now
  lists each outstanding department, who is assigned to its work (distinct, so two deliverables owned
  by one person is one name), and says the assigned owner prepares and finalises the brief and the
  tasks for each deliverable. Nobody assigned reads differently from no brief written, because they
  are different problems with different fixes. **(c) The Generate button left the campaign page** —
  *"the generate brief button should display on the tabs not on the main page… this would invite
  another user to generate the brief."* Correct, and it contradicted ADR-0072: one sweep above every
  department put the action in front of exactly the person the ADR moved it away from.
  `onWriteBriefs` and its four strings are deleted; `writeOneBrief` on the department's own tab is
  all that remains, and the button is held disabled with its reason rather than hidden when no
  template is resolved. **Settled after three wrong passes, and the last one is the rule.**
  Greyed the button out (says nothing); removed the disabling entirely (over-correction); held it
  but left a department with no template at all as a dead end. Edward: *"THE NON BLOCKING PRINCIPLE
  IS STRAIGHTFORWARD. IF THERE ARE NO BRIEFS ASSIGNED AT ALL THEY MUST BE ALLOWED TO PICK FROM THE
  FULL LIST."* So the dropdown falls back to the tenant's whole catalogue
  (`useAllBriefTemplates`), and the only remaining dead end is a tenant that has authored no
  templates at all — which names the screen that fixes it. The catalogue never stands in for a
  default even when it holds exactly one, or a tenant with a single template would silently write
  it for a department nobody configured. The button is held only while a choice the reader can
  make is outstanding, and choosing releases it. **And the copy is SHORT** — *"the message should
  be short and to the point, not mini essays"*: *"No default brief. Select a brief from the
  dropdown."*, *"Using the default Creative Brief. Pick another from the dropdown if you prefer."*,
  *"No brief yet for Creative. Generate it, edit it, then set the tasks."* Three strings deleted,
  seven rewritten, both languages.
  **(d) Amber, and spacing** — the campaign advisory becomes a `NoticeBox`, and
  the wizard's last five muted paragraphs with it (`intro`, the performance intro, and the three
  `role="status"` notes, which keep that role through a new prop so a screen reader still hears
  them). `.notice-box` now carries its own margins so every amber box on every screen sits the same
  distance from its neighbours, and the department section lost the rule that separated it from a
  section no longer beside it. 1676 frontend tests, typecheck, lint clean. No migration of
  its own; all ten of I40's are applied.

**I40 is complete bar `I40.4`, the two gauges** — the only item still open, and the only one Edward
flagged as not-now: *"the gauge is for exception tracking and reporting, at some point it goes
live."* Every gate green: `verify.sh` 91 files / 1013 assertions, 1648 frontend tests,
typecheck, lint, `check:authz`, `check:licenses`.

**One conflict to settle before building.** Edward's 4 Sep note also said *"step 4 timing, when
timings are set, the next button creates the campaign"*. **ADR-0067 has since superseded that**: the
campaign is created as a `draft` on leaving **step 1**, because a document needs a folder and a
folder needs a campaign. The draft-at-step-2 behaviour stays; only the review/approve merge is built
here. Flagged rather than silently resolved.

**Does this need an ADR? It did.** The first judgement here was that it did not — ADR-0048 d.8 keeps
the gate, ADR-0067 keeps the draft, and moving a surface is not a decision. That was wrong for one
reason found on 5 Sep while planning the build: `generate-brief` is gated on `projects:manage`, which
`20260816090000` says in its own comment that department-scoped roles do not hold. So the department
leads ADR-0070 makes responsible, and who receive `brief_awaiting_approval`, **cannot generate the
brief they are being told to write**. That IS an authority change, and it is **ADR-0072** (accepted,
5 Sep). Two other suspected gaps were checked and found already built — delivery and notification
(`20260903130100`), and the account manager holding `briefs:approve` — so neither needed an ADR.

---

### I41 — A task booked across days behaves like one
> Four defects found on 6 Sep while Edward drove a real multi-day assignment: a user booked Thursday
> for 2 days x 8h had all 16 hours landed on Thursday. Diagnosed in one session, fixed in order from
> 7 Sep. **Recorded here because they were written into `docs/memory/` and nowhere else** — a defect
> with no tracker row cannot be scheduled, and the remaining three needed somewhere to land.

- [x] `I41.1` **My Work sorted a multi-day task by its LAST day only.** `useMyAssignedWork` fetches
  `starts_at` on every row and `lib/my-work.ts` never read it, so a task booked Thursday-Sunday sat
  under "Other tasks" for the three days it was being worked on and reached "Today's tasks" on the
  day it was already due. It was never hidden and never duplicated — **both memory notes described
  it wrongly and the code settled it** (7 Sep). `isForToday` now takes the item, and a span that has
  begun is today's work; the row shows the span (`myWork.dueSpan`, EN/AR) so a due date four days out
  does not read as a mistake. **Both ends print through the same `slice(0, 10)` as before** — `I1.7`
  decides all nine of those renders at once, and half-fixing one here moves it a day west of UTC.
- [x] `I41.2` **"2 days" meant two CALENDAR days, so a day off ate one of them.** Booking Thursday
  for 2 days x 8h recorded the task as due **Friday** — the due date was read off the end date that
  was typed — and `spreadHours` then found one working day in Thursday-Friday and put all 16 hours
  on Thursday. **`spreadHours` was never the bug** and is unchanged: it was handed a span with one
  working day in it and did the only honest thing. The cause was three places counting calendar
  days, fixed together with `I41.3`:
  `expandDaily` now steps over the office's days off (the first day is never moved — a
  deliberately-picked Friday is still booked on the Friday and warned about, ADR-0061 d.2);
  `booking-transition` passes the office calendar so the server agrees with the client; and both
  dialogs take the due date from the last day the work was **placed** on rather than the one typed.
  Edward's call (7 Sep): the second day slides to Sunday, *"the assigner can drag to Friday, get the
  warning and proceed"*. **The per-day capacity preview was checking the wrong day** — Friday is
  empty because nobody works it, so an overloaded Sunday passed silently; it now previews the days
  the work will land on. `schedule.endsOn` says the end moved, at the point of decision.
  **No `deadline_changed` event was needed after all:** `sub_tasks` has carried `audit_row_change`
  since `20260812120000`, so every move of `starts_at`/`due_at` is already logged old-and-new.
- [x] `I41.3` **`expandSeries` stepped calendar days, not working days.** The cause of `I41.2`, and
  fixed in the same change — `workingDays` is optional on `SeriesInput` and passed only by the daily
  path. **Weekly is deliberately untouched:** stepping would break the same-weekday-every-week
  contract that is the point of a weekly series, and a weekly Friday booking in Baghdad stays on
  Friday.
- [x] `I41.4` **The working calendar is real.** ~~The committed baseline is a SPAN~~ — done:
  **ADR-0075 is accepted (9 Sep)** and its d.3 now stamps `committed_starts_at` alongside
  `committed_due_at`, so a task not started by its committed START warns rather than looking fine
  until its deadline has passed. What remains under this ID is the NEW ADR for the working
 calendar — **ADR-0079, accepted 9 Sep**, which moves
  the remaining work to `I41.11` and `I41.12`. The gap it closes: `workingDaysInRange`
  knows only a weekly pattern, no holidays table exists anywhere in the schema, and
  `resource_unavailability` is never consulted by the spreader — so every office works the same week
  every week of the year, Eid included.
  **ADR-0075 is settled and accepted; only the calendar ADR is left here.** ADR-0032 is
  *narrowed*: Edward — *"using the inputs provided now is a measure to allow tracking before defined
  SLAs are in place; the preference is having defined SLAs but not possible now"* — so the KPI matrix
  is where this is heading, not something replaced. The review buffer was **measured rather than
  chosen**: Creative, 48 completed reviews, median 1.3h but p80 16.1h and p90 21.9h — an overnight,
  so one working day — with a 260.6h outlier excluded as a review nobody did (ADR-0045's chase, not a
  planning constant). What remains here is the SPAN amendment above and the working-calendar ADR.
- [x] `I41.5` **Dragging a chip warned about nothing — now it asks.** `DayGrid`'s `onDrop` asked one
  question, `canMoveHere` (write scope), and then moved the booking. It never consulted the office's
  working week or the day's load; the target cell's `nonworking` shade was the entire signal, and
  shading is passive. Found by Edward driving the `I41.2` fix (7 Sep): *"dragged it back to Friday,
  no warning."* **This was the half of the 7 Sep decision that did not exist** — hours slide forward
  off a day off *because* the assigner can drag them back and be told what they are doing.
  A drop onto a day off, a blackout, or a day that would go over capacity now opens a
  `ConfirmDialog` itemising which of the three it is; a clean drop is as immediate as it ever was.
  **It warns, it never refuses** (ADR-0061 d.2), and `bookings` is audited either way. `overloadFor`
  moved out of the component into `lib/drop-check.ts` so what the cell DISPLAYS and what the drop
  WARNS about are one calculation and cannot drift, and it is unit-tested for the first time. The
  moving booking is removed from the target day before being counted onto it — dragging a chip
  sideways within a row would otherwise report a phantom overload from double-counting itself.
  Cross-resource drags take the same path, so they are covered too.
- [ ] `I41.6` **A task whose scheduling failed is stranded.** When `subtask-schedule` refuses, the
  RPC has already committed: the task exists, assigned, with no bookings. The **only** retry lives
  inside the `BookingDialog` that failed (`booking-unscheduled-retry` → `useRescheduleTask`, which
  has no other caller in `src/`). Close that dialog and there is no way back to it: **a task with no
  bookings has no chip, so the schedule has nothing to click**, and on `/deliverables` the Ad-hoc
  tab's row actions offer only Archive — the code calls that tab "an approved-only archive". The one
  route in is clicking the deliverable's NAME, which does not look like a route. Found live by
  Edward, 7 Sep, after a stale session 401: *"I cannot cancel the original."* Wanted: an unscheduled
  task is visible and retryable from the schedule, not only from the dialog that failed.
- [x] `I41.7` ~~⚠️~~ **The working-day rule now has its ADR — ADR-0078, accepted 9 Sep.** `I29.2`
  chose deliberately to keep a task's hours INSIDE its span; Edward reversed that in conversation on
  7 Sep and `I41.2`/`I41.3` were built the same afternoon, against `AGENTS.md` §8. The ADR is
  written late and **says so in its own opening** — the cost of skipping the step is that `I29.2`
  stood as an accepted decision saying the opposite of the code, with nothing marking which was
  current. It settles what a day count means (working days), that the first day is never moved
  (ADR-0061 d.2 kept), that an explicit placement is never re-derived, and that the forward slide is
  conditional on the drag warning existing (`I41.5`). It also records that `spreadHours` was blamed
  and was innocent.

- [x] `I41.8` **"At least 2 days before go-live" is a default, not a minimum.** Edward, 9 Sep:
  *"all deliverables should be finalised and approved at least 2 days prior to this date."* The two
  days exist — `DELIVERY_DAYS_BEFORE_GO_LIVE` in `src/lib/campaigns/go-live-dates.ts`, from Edward
  on 29 Aug — but `applyGoLiveDates` fills **blank** dates only, deliberately, so that moving a
  go-live does not silently re-plan a campaign somebody has already dated by hand. The consequence
  is that a due date typed one day before go-live draws no objection, and **no migration compares a
  deliverable's due date to its campaign's `go_live_at`** — checked across every migration, there is
  no constraint, trigger or raise. So the word *least* is currently unpoliced. **ADR-0075 d.9 settles
  the shape: WARN, never block.** Edward, 9 Sep: *"the philosophy of the system is non-blocking…
  allow to proceed after warning and record override."* The warning must state the arithmetic — hours
  of work outstanding against working days remaining — and name the severity, **tight** or
  **impossible**, telling the reader to resolve it with the client. Only a date AFTER go-live is
  refused. The override writes to `sla_events`, because an unrecorded warning is a click.
  **Built 13 Sep:** `classifyDueDate` in `lib/campaigns/go-live-dates.ts` (working days left vs the
  tenant's offset; hours outstanding vs the days' capacity when the deliverable exists);
  `DueDateWarning` under every due-date field in the wizard and in the change-promised-date dialog;
  after-go-live is refused on screen AND in `app.write_campaign_content`; the override rides inside
  the deliverable JSON at submit / `record_due_date_override` on an existing deliverable → a
  `due_date_override` `sla_events` row (migration `20260913170000`, pgTAP 112).

- [x] `I41.9` **The go-live dates count calendar days, and ADR-0078 says days are working days.**
  `minusDays` in the same file is pure calendar arithmetic — deliberately timezone-free, which is
  right, but it does not know the office's working week. A **Sunday go-live therefore gives a Friday
  delivery date**, a deadline on a day nobody in Baghdad works, and commence-by four days before
  that inherits the error. This is the exact class of defect ADR-0078 d.1 was written about
  (`I41.2`/`I41.3` fixed it in the spreader and the series expander); this file was not touched.
  Note the file's own header already calls the 2-and-4 rule a placeholder, because
  `deliverable_types.lead_time_hours` and `workflow_steps.default_hours` are empty — that is a
  separate and larger gap, and fixing the day counting does not depend on it.
  **Built 13 Sep:** `minusWorkingDays` steps back over the office's days off AND its closures through
  the one `isWorkingDay` test; the wizard reads the tenant's first office calendar
  (`lib/calendar/office-calendars-api.ts`) and the settings rule. A Sunday go-live in Baghdad now
  gives a Wednesday delivery.

- [x] `I41.10` **The scheduling numbers must be admin-adjustable, and the screen does not exist.**
  Edward, 9 Sep: *"please ensure the 2 days prior and 4 days prior are included as admin adjustable
  settings."* Three numbers, all currently uneditable: `DELIVERY_DAYS_BEFORE_GO_LIVE` (2) and
  `COMMENCE_DAYS_BEFORE_DELIVERY` (4), hard-coded in `src/lib/campaigns/go-live-dates.ts`, and
  ADR-0075 d.5's review buffer (one working day). `tenant_reminder_settings` is the right home —
  ADR-0066 built it for this shape of value, behind `organization:manage` — but **it has no admin
  surface at all**: one column, `brief_approval_hours`, and no file in `src/` reads or writes it, so
  the "Admin → Reminders" named in its own table comment was never built. This is therefore a new
  admin page plus three columns, not a field added to an existing form. Defaults stay as measured so
  a tenant that never opens it behaves as ADR-0075 describes.
  **Built 13 Sep:** three columns on `tenant_reminder_settings` (`20260913160000`, pgTAP 111), a
  **Scheduling rules** section at the top of Admin → Organization (behind `organization:manage`),
  `lib/settings/scheduling-settings-api.ts` read by the wizard, the due-date dialog and the extension
  arithmetic (`lib/deadlines/use-extension-context.ts`). Tenant-wide; a per-department buffer is not
  built.

- [x] `I41.11` **The working calendar has no closures — ADR-0079 accepted 9 Sep.**
  `resource_unavailability.resource_id` is `not null` and `LeaveDialog` refuses to save without a
  person, so a national holiday can only be entered one member of staff at a time — and anyone hired
  after the entry silently has no closure, so the system books them across Eid. ADR-0079 puts
  closures on the **office**: a new table keyed by tenant + office + date span, kind
  `public_holiday` | `company_closed`, a name and an actor; RLS reading tenant-wide and writing
  behind `leave:manage`. `OfficeCalendar` (`src/lib/capacity/types.ts:38`) gains the closure dates,
  which is the single seam — `workingDaysInRange`, the capacity preview, the drag warning and
  ADR-0075 d.5's go-live offsets all read it through that one type. `/people/leave` becomes the HR
  surface and its closure form asks for an office, not a person. Also drop the now-dead `'holiday'`
  arm of ADR-0013's leave RLS policy in the same migration. pgTAP must assert that a closure is
  visible to a resource created AFTER it was entered. Dates are entered by hand — ADR-0079 d.8, no
  import, so no feed to build or trust.
  **Built 13 Sep:** `office_closures` (`20260913150000`, pgTAP 110 incl. the hired-after assertion);
  `OfficeCalendar.closures` + `isWorkingDay` in `lib/capacity/working-week.ts` is the one seam — the
  spreader, the series expander, the capacity assessment, the grid's shading, both booking dialogs,
  `subtask-schedule` and `booking-transition` all read it (`lib/capacity/closures.ts` turns the
  `offices(…, office_closures(starts_on, ends_on))` embed into the calendar); `/people/leave` gains
  the closures half with `ClosureDialog` (asks for an office); the leave policy's `'holiday'` arm
  is retired.

- [x] `I41.12` **Work stranded on a newly-declared closure is listed, never moved.** ADR-0079
  d.5/d.6. Declaring Eid changes no existing booking — ADR-0078 d.3, an explicit placement is never
  re-derived — but doing nothing else would mean nobody finds out, so entering a closure produces
  the bookings now sitting on a closed day with their owners. Edward, 9 Sep: *"once the list is
  generated the authorised person can drag if required."* The drag is the existing gesture and warns
  on drop exactly as `I41.5` made it.
  **Built 13 Sep:** `office_closure_stranded_bookings(p_closure)` (same migration, security invoker)
  and `StrandedWorkPanel` on the leave page — shown straight after a closure is saved and from each
  row's "What's booked on it", with an "Open that week" link into `/schedule?on=…&who=…`.
---

### I42 — Finished work, and what a required reviewer looks like
> Both raised by Edward on 9 Sep from the pilot. Fadia Wael Amin reports that tasks assigned to
> her and since approved are still on My Work; and a reviewer marked required on `/deliverables`
> does not read as required when the same task is opened from `/schedule`. Neither is gated —
> `I42.1` needs one decision from Edward, `I42.2` needs none.

> **Measured against the live tenant, 9 Sep** (a one-off production diagnostic query (not included)).
> Three guesses made before the data are recorded as wrong: the My Work classifier is not broken,
> the mandatory flag is not failing to save (216 appointments, 25 mandatory, tenant-wide), and the
> cancel did persist. The actual fault is narrower than any of them.
>
> **"Al Waha KV" is FIVE separate ad-hoc jobs, one task each, all created by Fadia Mahmoud
> Ahmed Sabri inside fourteen minutes on 27 Aug** — 11:28:06, 11:28:10, 11:30:36, 11:42:01,
> 11:42:02. One is real (`bc4cb3f7`, done and approved — Edward, 9 Sep: *"the only real one is the
> approved one"*), one was cancelled properly (`c722a7a0`), and **three were archived by hand with
> their task still `todo`**. Those three are what Fadia is looking at.

- [x] `I42.1` **Archiving a job leaves its work live on the assignee's list, with no way to clear
  it — FIXED, ADR-0080 accepted 9 Sep.** `public.sub_task_cancel` archives an ad-hoc job only when
  no live task remains (`20260830150000` — correct, and it did that properly for `c722a7a0`), while
  the container's own transition looked at the tasks not at all, so a job archived from the row
  action stranded whoever was assigned. `isFinished` did not know `archived` or `delivered` either,
  so the task stayed in Tasks-for-today permanently — and **no surface in the product could reach
  it**: `DeliverablesPage.tsx:819` hides every task control once a container is `approved` or
  `archived`, the assignee cannot cancel her own work, and `archived` is terminal. Edward, 9 Sep:
  *"they are in complete marked completed — how am I supposed to cancel them now?"* He could not.
    - `20260909120000_archiving_a_job_calls_off_the_work_under_it.sql` — an AFTER trigger on the
      transition cancels every live task, releases its bookings and notifies its assignee, plus the
      data fix for the six stranded rows written as the general condition. **Not applied — Edward
      applies it.**
    - `supabase/tests/096_...sql` — 13 assertions. The load-bearing ones are negative: cancelling
      one task of three leaves the other two alone, an APPROVED task survives the archive, and two
      containers archived in one statement both work (the first cut used a temporary table and
      would have failed the second firing with "relation already exists").
    - `src/features/deliverables/lib/my-work.ts` — `SETTLED_CONTAINER_STATES` (d.8).
    - `bash scripts/db/verify.sh` PASS — 97 suites, 1069 assertions. `npm test` 1825 pass.
    - **The one-off cleanup script is deleted.** It existed only while the ADR was proposed; the
      migration does the three archived rows properly, and `Test Booking` sits under a live job so
      the app's own Cancel reaches it. One way to do this, and it is in the repo.

- [x] `I42.2` ~~**Five jobs created for one piece of work in fourteen minutes.**~~ **CLOSED by
  Edward, 9 Sep** — *"ignore the five jobs.. it was a glitch created some time ago which has been
  resolved."* Not re-investigated. Recorded because the CONSEQUENCE outlived the cause and is what
  produced the reviewer report: the two "Mr Crunch KV and SM direction" jobs (`ab7bc334`,
  `c7d31878`, 41 seconds apart) each appoint Ismail Nasser Abdelrahman, one with
  `is_mandatory = true` and one `false`. Set the flag on one from `/deliverables`, open the other
  from `/schedule`, and the box is correctly unticked for a different row. **Nothing is wrong with
  the flag** — every appointment tenant-wide checked, the mandatory ones all persisting. The duplicate
  ROWS still need settling; that is `I42.5`.

- [x] `I42.3` **The schedule modal never marks a required reviewer — FIXED.** The read-only
  Reviewers line printed `map(r => r.name).join(', ')`, and the `(required)` mark lived only inside
  `WaitingOn`, which by design names ONLY reviewers who have not acted — so the mark was missing
  before anybody approved and missing again afterwards, while `/deliverables` showed it throughout.
  New shared `src/components/ReviewerNames.tsx` (+ 6 tests) renders everyone appointed with the
  mark and the ADR-0061 d.11 deactivated warning; `EditBookingDialog` uses it. `WaitingOn` is
  untouched — it answers a different question and the two are deliberately not merged. No ADR, no
  migration: the flag was always saving, and both surfaces already read the one
  `fetchTaskReviewers`.

- [ ] `I42.4` **Nothing chases a reviewer who has not acted.** Not a defect —
  `app.maybe_complete_sub_task` is holding these correctly because a MANDATORY reviewer has not
  acted. Measured on one maker's tasks alone, several mandatory reviews had been waiting
  for over a week (per-person detail omitted from this public copy). The work is finished and
  waiting on a person, and no one has been told. **After every fix
  in `I42` these are still the largest thing on her list**, and they are the ones that look
  most like approved work that will not go away.
  **Decision (Edward, 9 Sep): C — do both.**
    - [ ] `I42.4a` **Edward tells the reviewers directly.** Now, outside the system. Costs
      nothing and clears those tasks this week; the build below cannot.
    - [ ] `I42.4b` **Build the chase.** Larger than it sounds and the estimate should say so:
      **there is no reminder machinery at all.** `tenant_reminder_settings` exists (ADR-0066,
      `20260903100300`) with one column, `brief_approval_hours`, and **nothing anywhere reads it** —
      no cron, no scheduled Edge Function, no job of any kind among the seventeen deployed. So this
      is the first reminder the system has ever sent, and it needs the runner as well as the rule.
      Depends on `I41.10` for the threshold: how many hours before a reviewer is chased is a tenant
      setting, and Admin → Reminders — named in `tenant_reminder_settings`' own table comment — has
      never been built. Belongs with `I30`.

- [ ] `I42.5` **Stale rows to settle.** Everything here is now reachable from the app or from
  `I42.1`'s migration; nothing needs a hand-written script.
    - **Done by the migration:** the three `todo` Al Waha KV tasks (`539d58ee`, `1c41d846`,
      `f5ebebb0`) — *"the only real one is the approved one"* — plus the three other stranded rows
      it finds (Basheer Mathai's, and one each on two test accounts).
    - [ ] **Edward, in the app:** `Test Booking` (`2831839a`) — *"Test bookings can be removed."*
      Its job is `in_progress`, so the Ad-hoc row now offers **Cancel job**.
    - [ ] **With Edward:** the two `Mr Crunch` jobs (6 and 7 Sep) — *"I need to check on my chips."*
    - [ ] **Still unanswered:** the second `Kite Travel - Key Visuals` (`9446ee6a`, `todo` since
      26 Aug, job `in_progress`). Nothing in ADR-0080 reaches it and it sits in Fadia's
      Tasks-for-today beside the approved one. Same shape as the Al Waha duplicates and
      probably the same resolved glitch — but it is live work assigned to a named person.

- [ ] `I42.6` **Does the Completed panel render on Fadia's My Work? Unconfirmed, and the two facts
  do not fit.** Edward, 9 Sep: *"on the my works there are only two lists.. today and upcoming"* —
  but the same day's measurement shows **twelve** of Fadia Wael Amin's tasks `done` under an
  `approved` deliverable, and `CompletedTasksPanel` (`MyWorkPanel.tsx:126`) returns `null` only when
  nothing classifies as finished. Twelve finished tasks and no panel cannot both be true.
  **The likely answer is that Edward was looking at his own page** — My Work is personal and he
  cannot open hers — and that assumption was made mid-diagnosis and never confirmed; it is written
  down here because an assumption nobody wrote down is how the first three readings of `I42` went
  wrong. **Edward is asking Fadia.** If the panel is there, close this. If it genuinely is not,
  it is a bigger defect than the one `I42.1` fixed and it is not the classifier — that is now
  covered by tests — so look at the read: `useMyAssignedWork` embeds `deliverables` on a LEFT join,
  and a PostgREST embed that fails to resolve comes back EMPTY rather than as an error, which would
  make every `deliverableState` null and every finished task read as open. That footgun has bitten
  this repo twice and is named in `traps.md`.

> **Noted and NOT a fault:** the eight "Nesmet Ataa" tasks are `done` with `approved_by` stamped
> while their reviewer row's `approved_at` is null. Those approvals happened 25–26 Aug;
> `sub_task_reviewers` was created on 27 Aug (`20260827100000`) and backfilled from
> `deliverables.reviewer_id`, which carried no verdict. A backfill artefact, not a live path.

### I43 — The local environment (ADR-0081, accepted 10 Sep)
> Where unreleased work is built. Local Supabase, real B2 under a dev tenant prefix, live email to
> plus-addresses behind `EMAIL_ALLOWLIST`, on the long-lived `redesign` branch.

- [x] `I43.1` **The local stack runs, and the seed produces a usable agency.** `supabase/seed.sql`
  (ADR-0081 d.6): one tenant whose id is deliberately the B2 storage prefix, one office on the Sun–Thu
  week, three departments, two teams under Creative, six plus-addressed users across the roles that
  matter, each linked to a bookable resource (ADR-0011), two clients and one approved campaign. No
  deliverables or tasks — the intake redesign is about how work is CREATED, and seeding work would
  hide the thing being built. Verified end to end: `supabase db reset` applies all 200+ migrations
  and the seed, a seeded Team Member signs in through the real auth endpoint, and the issued JWT
  carries `tenant_id`, `app_role_id`, `department_id` and `team_id`.
    - Two things bit and are worth keeping: **every seed id must be hexadecimal** (a readable
      `…t001` is rejected as `invalid input syntax for type uuid` — traps.md already carried this),
      and **`auth.users`' four token columns are nullable with no default and must still be written
      as `''`** — GoTrue scans them into non-nullable Go strings, so a NULL fails sign-in with
      `500 Database error querying schema`, a message that names neither the column nor the row.

- [ ] `I43.2` ⚠️ **The migrations never grant table privileges, and a fresh Supabase project cannot
  run this schema.** Found 10 Sep, immediately after `I43.1`: a seeded user signs in, and every read
  returns `42501 permission denied for table campaigns` — not RLS, but the `authenticated` role
  holding no table privilege at all. The current Supabase CLI's default privileges for `public` grant
  only `Dxtm` (truncate, references, trigger, maintain) to `anon`/`authenticated`/`service_role`;
  production, provisioned earlier, evidently still carries `arwd` and so the app works there.
  **The repo has an unstated dependency**: 200+ migrations create tables and force RLS, and not one
  grants SELECT — they rely on a Supabase default that has since changed. Three consequences:
  the local stack cannot read anything; **`verify.sh` has been masking it**, because
  `scripts/db/local-stub.sql:19` sets the default privileges itself before migrations run, so the
  whole pgTAP suite passes against grants the real schema never asks for; and **ADR-0081 d.9's second
  Supabase project would fail exactly this way**, at the worst possible moment.
  **Not a blanket grant.** Four revokes are deliberate — `user_profiles` (table-wide UPDATE replaced
  by a three-column grant, `20260801090000:33`), `sla_events`, `audit_events` and `campaign_concepts`
  — and `revoke update on <table>` drops column-level grants with it, so order matters and a careless
  `grant all` would quietly re-open three append-only tables. Security-shaped and schema-shaped:
  **wants its own ADR before anything is written.**
    - **Unblocked locally, 10 Sep, NOT fixed.** A clearly-flagged block at the head of
      `supabase/seed.sql` reproduces what production has and nothing more — `authenticated` only
      (`anon` deliberately gets nothing; M10 is not built), with the four narrowings re-applied after
      the grant in the order that keeps them. Verified against the running stack: `audit_events` and
      `sla_events` hold no UPDATE or DELETE, `campaign_concepts` no UPDATE, and `user_profiles` has
      table-wide UPDATE removed with only `display_name`, `locale`, `office_id` granted back at
      column level. **Delete that block when this item lands** — it is a stand-in, and it lives in
      the seed rather than a migration precisely so it cannot be mistaken for the fix.
    - **The trigger for doing this properly is a second environment, not a date** — ADR-0081 d.9's
      staging project, a region move, or a rebuild. Whichever comes first.

### I44 — One way in: the new-request front door (ADR-0082–0086, 0090 — built, in review)
> Edward, 10 Sep, from the Figma `▶ CS Flows` page. **Being specified one screen at a time at his
> request**, so this section grows as each is settled rather than being written up front.
>
> **Scope.** The front door and the SINGLE JOB flow behind it. **"Full campaign" opens the wizard
> that already exists, unchanged** — the campaign builder is NOT being rebuilt.
>
> ⚠️ **The Figma campaign screens are NOT a specification.** Edward: *"the campaign brief flow in
> figma is not actually correct against implementation."* Read `SJ-*` only; anything on the CAMPAIGN
> flow will describe a product that does not exist.

**Edward's adjustments to the Figma, 10 Sep — captured, not yet each turned into an ADR:**

- **"Took it on a call" is REMOVED.** *"We cannot draft a confirmation message based on nothing."*
  Instead the user can **request a WhatsApp confirmation or an email**, and add the reply as evidence
  at step 2. Note this does not close `I35.6` so much as re-shape it: an unevidenced job exists while
  the confirmation is awaited.
- **SJ-02's evidence upload reuses the EXISTING path** (ADR-0066's receipt + References filing), not
  a second one.
- **SJ-03 uses the `single_execution` brief template**, which already exists and already has exactly
  **six fields** — Deliverable Type, The Task, Reference / KV, Specs, Copy / Message, Restrictions,
  bilingual with guidance — matching SJ-01's *"six fields plus a proof screenshot"*. **Note the
  Figma's SJ-03 shows a different set** (Objective / Key message / Audience / Mandatories / Language,
  prefilled from the client profile); whether that prefill survives is an open question for that step.
  Department-specific detail must follow the department selected.
- **SJ-02 settled (Edward, 10 Sep):** *"who asked"* is **free text**, because the request may be
  internal rather than from a client contact — so no contacts table. The receipt is reused **in
  full, including the model reading the screenshot and the human confirming it** (ADR-0066
  unchanged) — which **overrides the Figma**, where the arrival time is typed by hand and the proof
  is labelled *"stored as proof, never read"*. **A campaign IS a project**: *"as far as I am
  concerned a campaign is a project… the only difference is no campaign strategy, and a single job is
  typically one deliverable to one department"* — so a single job is a campaign row and
  `campaign_brief_receipts` needs no change. **Requesting a WhatsApp or email confirmation is a
  MANUAL step, not a programmed one** — the account manager asks outside Maestro and uploads the
  reply as evidence when it arrives; nothing is built for it.

- **ADR-0082 and ADR-0083 ACCEPTED, 11 Sep** (*"accepted proceed"*). 0082 d.9 — existing ad-hoc
  work hidden, not deleted — taken as confirmed by that acceptance.
- **SJ-03 settled (Edward, 11 Sep):** *"for now we will use the Single Execution template, for a
  single job. This will be the only brief for this style of work."* Answers both open questions at
  once — always `single_execution`, and the department generates no second brief. **ADR-0084
  drafted, proposed; accepted 11 Sep.** It amends ADR-0048 d.9 / ADR-0070 / ADR-0072 for single jobs only: the
  account manager writes the brief at creation, before approval, and it is approved with the job.
  Nothing prefills from the client profile. **"The Task" is the one mandatory field** — decided in
  the ADR because no template anywhere has a `required` flag (144 fields, zero); flagged as the line
  most likely to change.
- **SJ-03, three decisions settled by Edward in plain terms (11 Sep) and folded into 0084:**
  **ingestion** — upload and ingest into the six fields, *"facts only, not invent"*, the person
  reviews and edits before Next; **the existing `ingest-brief` is NOT template-driven** (a fixed list
  of fourteen campaign fields, `BRIEF_FIELD_KEYS`), so the prompt and schema are derived from the
  template's own `key` + `guidance` — this is the real build. **"What could stop this" STAYS as free
  text**, as a reminder carried to the task-list review where the owner attaches a real dependency
  (reverses the draft's d.8). **The AM approves for release** — the department's engagement with the
  brief is the *Creative Brief* task most workflows already carry, not a second gate.
- **SJ-02 gains a required JOB TITLE** — *"all campaigns have a title; technically the single job is
  still a campaign."* Added to ADR-0083 as a dated addendum (accepted ADRs are not rewritten).

- **SJ-04 is the review and APPROVE screen. ADR-0085 drafted, proposed (11 Sep; accepted the same day)** — written from
  what Edward had already decided, without re-asking: read-only review, one **Approve** press by the
  AM that approves the job through the existing scoped `approve_campaign`, stamps the brief and
  releases the deliverable to its owner; **the duplicate check fires on Approve** and the approval
  waits on its answer; **release = the owner is notified and the job enters their queue at the
  task-list review step, with tasks generated and HELD** (the next ADR says how "held" works —
  today `materialise_deliverable_workflow` fires from a trigger on write). No promote box (A2 lives
  on the campaigns list); no "what the client sees" panel (`M10` is not built — the mock's sentence
  is recorded in the ADR as that portal's spec). Cancel leaves a resumable draft (ADR-0067). The
  response time is shown from the confirmed arrival, prominently — this is the screen where it ends.
- **SJ-A1 to SJ-A3 are pop-up modals, not steps**: A3 (add a brand) opens from the brand dropdown;
  A2 (turn this into a campaign) is triggered from an action button **on the campaigns list**;
  A1 (similar job) is *"probably"* triggered by the approve button.
  **ADR-0086 drafted, proposed (11 Sep).** A3 is **already built** — `AddBrandDialog`, I35.3, 3 Sep;
  reused, no decision. A1: trigram similarity on the title over this client's OPEN jobs only, score
  shown, threshold 0.4 deliberately loose, **warns and offers, never refuses** — "add as a
  deliverable on that job" re-parents deliverable + brief + attachments + receipt onto the existing
  campaign in one transaction and discards the draft, so the clock stays on the original start by
  construction; the exact-name unique constraint stays for literal collisions. `pg_trgm` is not
  enabled and will be. A2: **`campaigns.kind` (`single_job` | `campaign`)** — a stored fact, not
  inferred from empty fields — Promote is a row action for single jobs, sets `kind = 'campaign'`
  and opens the existing wizard at step 2 with step 1 marked done; one-way. Nothing is copied
  because everything is already on the campaign row (ADR-0083 d.3).

- **ADR-0086 ACCEPTED, 11 Sep** (decision 14 — `campaigns.kind` a stored fact).
- **ADR-0090 ACCEPTED, 11 Sep — the owner approves the task list.** Single jobs only: Edward
  corrected a draft that had missed ADR-0070's second gate (department brief approval already holds
  campaign tasks until the department accepts). The task-list approval is the single job's
  equivalent. `tasks_approved_at/_by`, one check in `tg_sub_task_assignment_gate`, one RPC, one
  button. Held tasks are excluded from the `/schedule` picker and counted separately as *awaiting
  the owner's review*; the owner assigns, Traffic backstops.
- **BUILD STARTED 11 Sep** — five agents in parallel, each on its own worktree branch:
  intake backend (0082–0086, 0090 migrations + RPCs + ingestion), intake frontend (the door and
  every screen), `I47` review cycle (0089), `I45` booking requests (0087), `I46` (ADR-0075's
  missing migration + the side door + 0088). Independent review agents follow. `verify.sh` gained
  `MAESTRO_VERIFY_CONTAINER` so parallel runs do not collide.
- **BUILT AND REVIEWED, 11 Sep** — five branches integrated on `redesign-integration`; five
  independent reviewers (0089; 0087 + the gate; 0075/0088; intake end to end; adversarial
  security) found **no blocker** and eleven MAJORs, all fixed on the integration branch the same
  day. The pattern in eight of them is the ADR-0055 lesson — a rule held by an RPC while a policy
  left the window open — now closed in Postgres (`20260911130500`, `20260911130600`, and edits to
  the unpushed 0075/0088 migrations). pgTAP 1355 → 1386 assertions; unit 2088 → 2090. Each ADR
  carries a dated addendum for what the review changed.
  - [x] `I44.1` the door: `Ctrl/Cmd+P`, `projects:manage`-gated, the New button on `/campaigns`;
    claimed from inside a field too (0082 addendum).
  - [x] `I44.2` SJ-02: title, client/brand (A3 reused), free-text receipt with human confirmation
    (ADR-0066 whole), department → lead as owner, typed due date at close of day, capacity for the
    due week (`useTeamLoad`).
  - [x] `I44.3` SJ-03: the `single_execution` brief, ingestion derived from the template's own
    keys (`ingest-brief` takes `briefType`), "what could stop this" free text.
  - [x] `I44.4` SJ-04: one Approve — complete the draft, approve through the scoped
    `approve_campaign`, release stamps the brief, owner told (`campaign_approved`).
  - [x] `I44.5` SJ-A1: `similar_open_jobs` (`pg_trgm`, ≥ 0.4) on Approve; warns, never refuses;
    a check that cannot run does not refuse either. Attach re-parents in one transaction.
  - [x] `I44.6` SJ-A2: `campaigns.kind`; Promote from the list, one way, fenced; opens the
    campaign page (0086 addendum — not the wizard).
  - [x] `I44.7` ADR-0090: `tasks_approved_at/_by` (fenced), `approve_deliverable_tasks` (owner,
    `deliverable_owner:manage` in scope incl. the AM), the gate branching on `kind`, held tasks out
    of the `/schedule` picker and counted as *awaiting the owner's review*.
  - [x] `I44.8` **ADR-0083 d.9 had no mechanism** — built 11 Sep after Edward chose to enforce it
    everywhere, campaigns included (option A). `app.tg_deliverable_owner_is_a_lead`
    (`20260911130700`, test 107): on campaign work the owner's role reaches beyond themselves
    (`roles.scope <> 'self'`, never a role name) and a department/team-scoped actor reassigns
    within the department; ad-hoc and internal-project work untouched; existing rows untouched
    until reassigned (the migration reports the live count per tenant). Both owner pickers offer
    leads only (`useDeliverableOwnerCandidates`); a department lead's is narrowed to their
    department. ⚠️ **Before `db push`:** read the migration's notice — each live campaign
    deliverable a team member owns is reassigned to a lead by hand, before or after.
  - [ ] `I44.9` **`useCampaigns` (schedule) and `useCampaignKinds` select `*`** — every campaign's
    `brief` jsonb to read one column; `useCampaignKinds` has no caller. Narrow after `gen types`.
  - [ ] `I44.10` **Attach onto a released single job for a NEW department leaves an unapproved
    brief** the AM cannot approve (`approve_department_brief` is department-scoped) — the list
    shows "1 of 2 briefs" for ever. Test 106 covers only the campaign target.
  - [ ] `I44.11` **`ingest-brief` has no rate limit** (AGENTS.md §6 asks for one on privileged
    routes). Cost only.
  - [ ] `I44.12` **The wizard cannot resume a released campaign at Strategy** — ADR-0086 d.10's
    destination. Promotion goes to the campaign page instead (0086 addendum); if Edward wants the
    wizard, `useCampaignDraft`'s status filter and `write_campaign_content`'s re-insert both change.
  - [ ] `I44.13` **Role names in `app.approve_campaign`** (`20260911130200:87,113`, reproduced
    byte-for-byte from `20260905190200`) route the *notification*, not the authority — sanctioned
    by ADR-0070 d.6 / ADR-0073 — but it is the last role-name test in the schema and ADR-0074 d.3
    says "no exception left". Fix on next touch.

- **DESIGN PASS + FOUR DECISIONS, 12 Sep** (ADR-0082 addendum). Edward tested the first build and
  found the screens did not match the Figma; the fields are right (data is the source of truth for
  those), the visual was not. Rebuilt all seven CS-Flows surfaces to the frames on a reusable
  component layer (`Modal`, `Tag`, `Field`, `Panel`, `StepRail`, `PillSelect`, `ChoiceCard`,
  `PromoteDialog`) from the `.pen` tokens, responsive + RTL, each screenshot against its frame.
  - [x] `I44.1a` the design pass: door, SJ-02/03/04, A1, A2, A3.
  - [x] `I44.1b` **decision 2** — `Ctrl/Cmd+P` claimed for everyone; a non-manager gets a message,
    not the browser Print.
  - [x] `I44.1c` **decision 3** — the campaigns list is read-only for all (`projects:view`,
    `20260912100000`, test 108); write actions stay `projects:manage`.
  - [x] `I44.1d` **decision 4** — the "+ New internal project" door removed; internal work comes
    through the same door with the agency as the client; existing internal projects stay viewable.
  - [x] `I44.1e` fixes from the test run: login-page banner; New-button shortcut keycap;
    `clients.saveFailed` missing key; the brand "failed" was a stale login after a reset (traps.md).
  - [ ] `I44.14` ⚠️ **Restore ad-hoc creation on `/schedule`** (decision 1). The first build retired
    it early (ADR-0082 d.8); Edward's rule is it comes off only after thorough testing + merge +
    ≥1 week on production, at his call. Restoring is a partial revert of `ea92901` entangled with
    the ADR-0087 booking-request work built on top — it needs its own change and test pass, not a
    rushed bundle. **Deferred, on purpose.**
  - [x] `I44.15` **The account manager does not approve the task list** (ADR-0090 addendum, 12 Sep).
    Found while Edward tested: `approve_deliverable_tasks` admitted the campaign's AM (migration
    `20260911130600` passed the deliverable's AM into `in_write_scope`), and the UI offered the
    "Approve task list" button to any unscoped `deliverable_owner:manage` holder — a dead-end for
    those the RPC refuses. Fixed: authority extracted to `app.may_approve_deliverable_tasks`
    (owner, or `deliverable_owner:manage` in the **department's** scope incl. the tenant failsafe —
    **not** the AM's account branch); a PostgREST computed column `can_approve_tasks` drives the
    button from the same predicate. Migration `20260912110000`; pgTAP `103` flips the AM to refused
    and asserts the column agrees. Also done 12 Sep in the same test pass: the SJ-03 "Next → review"
    dead button now explains itself (a modal: confirm each filled field), the misleading "two fields
    still empty" footnote removed, and the ingest message rewritten to say Keep each field.
  - [x] `I44.16` **A campaign deliverable always has an owner; "Nobody" is never offered** (ADR-0083
    addendum d.11/d.12, 12 Sep). Found while Edward tested the reassign control: the owner picker
    offered "Nobody" and the DB accepted a null (`owner_user_id` nullable; `20260911130700` left
    clearing open). Fixed everywhere (Edward: *"Both, same rules on full campaign"*):
    (1) **backend** — `tg_deliverable_owner_is_a_lead` now refuses clearing an owner that is set on
    campaign (stream) work; born-null still allowed (migration `20260912120000`, pgTAP 107 +3);
    (2) **Change-owner control** — no "Nobody"; when the department has no lead it offers that
    department's **team leads** with an explanation, Save blocked until a real owner is chosen;
    (3) **single-job release** — when there is no department lead, the AM names a team lead (new
    `useTeamLeads`, a picker on SJ-02) and release is blocked until one is named, replacing the old
    passive "will wait"; (4) **full campaign** already forces an owner per deliverable, covered by
    (1)+(2). Ad-hoc and internal-project work keep their own owners, untouched.

### I48 — testing fixes found walking A–B1 (13 Sep)

Edward's consolidated list from test pages A–B1 (he is at page 4 of 12). Captured here so none is
dropped; fixed incrementally, one at a time. ADR-0091 (campaign close-out) and ADR-0092 (processing
+ error reporting) cover the two that are decisions, accepted 13 Sep.

- [x] `I48.1` **Campaigns list — search/filter by name, brand and client.** A text search over the
  list (and drafts), matching campaign name / brand / client.
- [x] `I48.2` **Campaigns list — relabel the "Brief" column to "Campaign/Project brief".** The
  `campaigns.colBriefStatus` header.
- [x] `I48.3` **Campaigns list — the Actions column is empty** for full campaigns and non-managers.
  Populate it (Open, plus the close-out action from `I48.9`, plus the existing single-job Promote/
  resume).
- [x] `I48.9` **Campaign close-out (ADR-0091).** A `closed` status; `close_out_campaign` /
  `reopen_campaign` RPCs authorised as approval is, refused while work is unfinished (message names
  what is outstanding), reversible; the list defaults to open with an open/closed filter. Migration
  + pgTAP + the Actions-column button.
- [x] `I48.4` **A5 — the no-access message is wrong.** It reads "New work comes in through your
  account manager / You do not have access to raise a request here…". It should reference creating a
  PROJECT: "Ask an Account Manager to create the project for you, or, if it is an internal project,
  request the required permissions." (`intake.door.noAccess`.)
- [x] `I48.5` **A6 — reactivate ad-hoc creation on `/schedule`.** ADR-0082 d.8 retired it from
  `BookingDialog`, but Edward did not ask for it to be switched off yet (decision 1: off only after
  thorough testing + merge + ≥1 week on production, at his call). Restore the ad-hoc creation path.
  Supersedes the deferral recorded as `I44.14`.
- [x] `I48.6` **A6 / ADR-0092 d.4 — the new-booking modal must close on outside-click and Esc.**
  `BookingDialog` (and `EditBookingDialog`, `AssignmentRequestDialog`) move onto the reusable
  `Modal`, which already does backdrop/Esc dismiss and focus-trap.
- [x] `I48.7` **B1 — the "fill in the fields" message must LIST the missing mandatory fields.**
  `intake.errors.incomplete` is generic ("Fill in the fields marked * before moving on."); it must
  name each unfilled required field. `requestMissing` already returns the keys. **Re-reported — was
  meant to be fixed and the message is still wrong.**
- [x] `I48.8` **ADR-0092 d.1/d.2 — a blocking "please wait …" modal on every processing action**
  (submit/save/upload/ingest), then a plain success or error. Shared `ProcessingDialog` (the
  message-carrying `BusyDialog`), applied to the intake flows under test first, then rolled out.
  **Started 13 Sep:** brief ingestion now shows a blocking "Reading the document…" modal
  (`BriefIngestPanel`, both wizards); release already had one. **Finished 13 Sep (second pass):**
  promote / close-out / reopen on the campaigns list, writing the department briefs and approving on
  the campaign page, concept proposal and regeneration, and every upload (Library, review versions,
  campaign documents).
- [x] `I48.10` **ADR-0092 d.2 — error copy is plainly worded, never generic.** Reword generic errors
  ("Something went wrong", "Save failed") on the surfaces this pass touches; ongoing.
  **Swept 13 Sep (second pass):** the 31 remaining generic strings in EN and AR now say what
  happened, what state things are in, and what to do; the error dialog's heading is "That did not
  work".
- [x] `I48.11` **ADR-0092 d.3 — error dialogs carry "Report to your administrator".** A new
  `report-error` Edge Function emails the tenant's Power Admin(s) at their recorded address, via
  Resend (server-side, Edward's call), the error text + what the user was doing; `EMAIL_ALLOWLIST`
  fences it locally. Zod at the boundary, error envelope, no grant-table read (ADR-0037).
- [x] `I48.12` **ADR-0092 d.4 — migrate the remaining ~14 hand-rolled dialogs onto the reusable
  `Modal`** (admin dialogs, client form, leave, extension request, due-at, send-feedback, …). A
  consistency pass, not a blocker for the testing run. **Done 13 Sep (second pass):** all sixteen
  feature dialogs use `Modal card={false}` (backdrop-click, Esc, focus-in); `NoticeDialog`,
  `ConfirmDialog` and `BusyDialog` keep their own chrome as the shared notice components.
- [x] `I48.13` **The campaign list shows a single job waiting on its task list, not "brief approved".**
  A single job's brief is stamped at release (ADR-0084 d.4), so the list read it as approved before
  the owner had approved the TASK LIST (ADR-0090). The `campaign_list_rows` view now carries
  per-campaign task-list-approval counts (migration `20260913130000`) and the list shows the
  task-list state for single jobs; campaigns are unchanged.
- [x] `I48.14` **A single job's owner is sent to the deliverable, not the campaign page.** The release
  `campaign_approved` notification for the owner of a single job is retargeted to the DELIVERABLE
  (entity → `/deliverables?open=<id>`), where Approve-task-list and reassign-owner live (migration
  `20260913140000`, reproducing `approve_campaign` with a targeted update; pgTAP 104 updated). The
  single-job campaign page also carries an "Open the deliverable" link and a note that the brief is
  on the department tab (`I48` frontend).
- [x] `I48.15` **The single refined concept (ADR-0065 addendum d.9–d.11).** Drop content types from
  `propose-concepts`; one working concept with per-item Keep/Delete; "Regenerate removed" fills only
  the deleted slots from the kept items as context. Edge-function handler + schema + prompt, a
  data-model change (mutable concept, per-item delete) + pgTAP, and a `ConceptsPanel` redesign. Its
  own tested build — wants in-browser verification, not bundled.
  **Built 13 Sep (second pass):** `campaign_concepts` is one row per brief (unique), items carry ids,
  `slots` counts deletions per shape, an UPDATE policy behind `projects:manage`,
  `campaign_concept_mark_item(keep|delete)`, a regeneration stamp trigger (`20260913180000`, pgTAP
  113; 078 amended). `propose-concepts` drops content types, proposes on a first press, and on a
  later press regenerates exactly the open slots with the kept items as fixed context (409 when
  nothing was removed). `ConceptsPanel` shows the one concept with Keep/Delete per item and
  "Regenerate removed (n)". Existing sets collapsed to the newest per brief.
- [ ] `I48.16` **Default landing pages per role — settled AFTER the dashboards are built (Edward, 28 Sep).** Edward, 12 Sep: dashboard for department & team
  leads, `/my-work` for team members. **Parked 13 Sep — waiting on the UI/UX work**; the dashboard
  is guarded by admin grants leads do not hold and its panels by `health:view`, so landing them
  there is an authorization question as well as a route change. Do not build until the design is in.
- [ ] `I48.17` **The inbox does not update live — a notification appears only after a reload.**
  Edward, 13 Sep: changed a single job's owner to the team lead; the `deliverable_reassigned` row was
  written (10:35, addressed correctly, `realtime.messages` carries the broadcast) but the team lead's
  bell stayed empty until a reload. The inbox refreshes ONLY on the realtime push
  (`useNotificationsChannel`, private channel `tenant:<t>:user:<uid>`); a subscribe failure is
  silent and there is no polling or focus-refetch fallback. Chat uses the same mechanism and is
  likely affected. Fix wants (a) a polling + window-focus fallback so the inbox can never go stale,
  and (b) a browser-level diagnosis of why the private channel does not deliver locally.
  **Parked (Edward, 13 Sep): test and fix on the live server, not now.**
- [ ] `I48.18` ⚠️ **Review by link, file once at final approval.** Edward, 13 Sep: the team reviews
  Keynote on iCloud together; every review round today needs a version UPLOADED, so files go up and
  down several times on unreliable office connections. Server-side download from an iCloud share
  link is NOT reliably possible (no API; the link opens Apple's web app), so the proposal is: each
  round submits a **link** (the per-version `external_review_url` already exists, unsurfaced),
  reviewers work in Keynote and approve/request changes in the system, and the **final approval
  alone requires the file** — which is then filed into the project folder. NOTE: today approval
  files NOTHING into the Library (`I11.4` — `deliver_deliverable_version` exists and nothing calls
  it), so the upload-every-round rule is not delivering its own purpose. Amends ADR-0058 d.5 /
  ADR-0059; needs an ADR first. **Gated on Edward: who uploads the final file — maker or approver?**
- [x] `I48.19` **The seed and the harness match the test plan.** Edward, 14 Sep: *"the accounts seeded
  … are insufficient to match the testing … a department with no dept lead but at least 2 team
  leads"*, plus every notification and email testable without Resend, runnable by an independent
  CLI with Playwright. Built 14 Sep: 20 seeded people across four departments (Production lead-less
  with two TLs, Strategy with nobody senior), two offices, four clients; `EMAIL_TRANSPORT=mailpit`
  in `notify-email`/`report-error` via `_shared/email-transport.ts`; the seed installs the Vault
  secrets the email queue needs; `playwright.local.config.ts` + `e2e/local/` (fixtures, auth
  setup, db + Mailpit helpers, exemplar specs for section M and for one notification proved three
  ways); `docs/E2E-PLAN.md` maps every retest step and every notification type to actors and
  assertions. The remaining spec families are the CLI's to write from the two exemplars.
- [x] `I48.20` **The provisioning wrapper had lost FOUR seeds.** Found 14 Sep by the automated
  retest (C5: every AM read "you may not hold the Assets permission"). `20260905090800` reproduced
  `public.seed_tenant_roles` from the 30 Aug base and dropped `seed_tenant_asset_grants`,
  `seed_tenant_storage_settings` and `seed_tenant_reminder_settings` — the same loss
  `20260903100300` had already repaired once; `20260905190300` copied the loss forward. Any tenant
  provisioned since 5 Sep (the local seed tenant included) had no `assets:manage` outside Power
  Admin, no storage-settings row and no reminder-settings row (so the 13 Sep scheduling rules could
  not be saved). Fixed forward in `20260914100000` (wrapper reproduced whole + the three restored +
  a backfill for every tenant); **pgTAP 114 now provisions a fresh tenant, asserts every seed's
  footprint, and fails if any `app.seed_*` function exists that the wrapper does not call** — the
  guard that was missing both times. The hosted tenant predates the loss.
- [x] `I48.21` **Approving a department brief did not refresh the campaign page.** Found 14 Sep by
  the automated retest (G4): the approval landed (`approved_at`, `approved_by` set) but the tab kept
  "Approve this brief" / "not yet approved" until a reload — `useApproveDepartmentBrief` invalidated
  `['campaigns']` and `['deliverables']`, and the page reads `['campaign-detail', id]`. Fixed: the
  mutation invalidates `campaign-detail` too.
- [x] `I48.22` **An optional reviewer's Done kept reading "no comment" after they wrote feedback.**
  Found 14 Sep by the automated retest (J2): ADR-0089 d.5 has the button read *Done — feedback
  left* / *Done — no comment* by what the server would record, but the kind (`useMyResponseKind`)
  was fetched once on open and never re-asked when a comment was added, so the label lied until the
  modal was reopened (the record itself was right — `sub_task_respond` derives the kind
  server-side). Fixed: `useAddTaskComment` and `useAddComment` invalidate
  `deliverableKeys.responseKind(...)`.
- [x] `I48.23` **Uploading a version left the rail on "No versions yet" until the modal was
  reopened.** Found 14 Sep by the automated retest (K3): `useUploadVersion` invalidated
  `reviewKeys.versions(deliverableId)` — the un-narrowed key — while the rail in the Submit / Review
  modals is narrowed to the task (`…, deliverableId, subTaskId`, ADR-0058 d.1), so only the submit
  gate refreshed. Fixed: the mutation invalidates the `reviewKeys.allVersions(deliverableId)` prefix.
- [x] `I48.24` **The go-live day was refused by the server and allowed by the screen.** Found 14 Sep
  by the automated retest (K6b): `deliverable_due_at_change` compared 18:00 Iraq on the day with
  `go_live_at` as a moment (03:00 Iraq), so the dialog said *impossible — proceed and it is
  recorded* and the database said *after the campaign goes live*. **Decided by Edward, 14 Sep, as
  ADR-0093:** no door refuses a date after go-live — the wizard, the promised-date dialog and the
  extension request all warn that the date is past go-live and the client's agreement is needed,
  allow it, and record the override with severity `after_go_live`. Migration `20260914130000`
  re-emits the three functions whole and widens `record_due_date_override`; pgTAP 101/112 updated;
  `DueDateWarning`, `DeliverableDueAtDialog`, `BriefWizard`, `ExtensionRequestDialog` + copy (en/ar).
- [x] `I48.25` **Extension arithmetic read "Leaves -27 working days" past the deliverable's due
  date.** Seen 14 Sep (K7). Edward: reword, and say it is subject to approval. Now *"This is 27
  working days past the deliverable's own due date — the account manager will need to approve it,
  and may need the client's agreement."* (`extension-text.ts`, en/ar, unit test.) Part of ADR-0093.
- [x] `I48.26` **A refused scheduling-rules save said "Scheduling rules saved."** Found 14 Sep by the
  automated retest (M1, as the CEO — `admin.organization:view` without `organization:manage`):
  `useUpdateSchedulingSettings` ran an UPDATE that RLS filtered to zero rows, which is not an error
  to PostgREST, so the mutation resolved and the success notice showed while the database was
  unchanged (traps.md: the zero-row update). Fixed: the update selects the row back and throws
  `42501` when nothing came back; the page says *"Only somebody who manages the organisation can
  change the scheduling rules. Nothing was changed."* (en + ar).
- [x] `I48.27` **The stranded list was titled "— this closure" straight after declaring one.** Found
  14 Sep (M3): `ClosureDialog.onSaved` returned only the id, so the page had no name on create and
  fell back to the placeholder. Fixed: the dialog hands back the name it just saved.
- [x] `I48.28` **"This brief has nothing written in it yet" never reached the screen.** Found 14 Sep
  by the automated retest (N8): `propose-concepts` refuses an empty brief with 422 `brief_empty`
  (and "nothing removed" with `nothing_removed`), but `useProposeConcepts` looked for the code in
  `data`, which supabase-js leaves null on a non-2xx — the body is on `error.context`. Both
  refusals presented as *"The concept could not be proposed right now"*. Fixed: the code is read
  from the response, the way `review-api`'s `invokeFn` already does.
- [x] `I48.29` **A manual-review task can be submitted with a link.** Edward, 14 Sep: *"we need to
  add an option on each task that requires review to switch between Digital or Manual"* — that
  switch exists (ADR-0059 d.5: the booking dialog and the reopened task both carry it) — *"If it is
  manual then when it comes time to submit for review… insert a url and submit. Offline users will be
  advised this only applies to the final approved version which will happen offline."* So: the
  manual Submit modal gains an optional **link** field beside the maker's note (the reviewer sees
  it as a link in the thread), and one line of copy for offline work. One column on
  `review_feedback` (or the task), one field, one sentence. After the merge; needs a short ADR-0059
  addendum. The final approved file stays a manual upload step for now (I48.18 parked). **Built
  15 Sep** — ADR-0059 addendum d.14–d.18 (accepted): `review_feedback.link_url` (`20260915110000`,
  http(s) CHECK at the database, pgTAP 118); the note stays required and the submit gate is
  untouched; `TaskReviewThread` gains *Link (optional)* and renders the link under the note for maker
  and reviewer; the offline sentence is the maker's; the manual submit modal no longer says
  "Upload". Retest `e2e/local/retest-redesign/o-manual-link.spec.ts` (Section O; `GUIDE_SHOTS=1`
  re-shoots guides 7 and 8's two new images). Checked and NOT needed: the owner's task list already
  shows and edits the mode (guide 5 §2).
- [ ] `I48.30` **Where the stranded-work list lives.** Edward, 14 Sep, seeing the list on People →
  Leave: *"The leave section is for HR to manage leave and set holidays etc. — we will deal with this
  later, as right now only the power admin has access to the leave page."* Today the list appears on
  that page when a closure is declared (ADR-0079 d.6) and from the closure's row. When leave:view is
  given to HR, decide whether the list belongs to Traffic (the schedule) rather than HR (the leave
  page). **Parked** until the HR role exists.
- [ ] `I48.31` **Prove migrations on a populated database.** Two production pushes failed on 14 Sep
  (`20260911120000` 55006 pending trigger events; `20260912100000` a system-role grant refused) on
  statements that touch zero rows on the throwaway database and on a fresh `db reset` — both are
  empty when a migration runs, production is not (traps.md). Proposed: `verify.sh` seeds an
  organisation, roles, people and assigned tasks BEFORE the migrations under test, so a "for every
  assigned task…" backfill meets rows before it meets Edward's. Also: the RUNBOOK's deploy order
  gains "regenerate types after `db push`". Not agreed yet — Edward's call.
- [x] `I48.32` **One reusable button.** Edward, 14 Sep, reviewing the deployed pages: *"there is a lot
  of nav links instead of reusable button components… lets start with appropriate reusable action
  buttons"* — and *"anywhere we can use an icon is preferable to text heavy buttons."* Found: no
  button component at all; 150 `link-button`s doing delete, approve and open in one look; five
  competing "primary" rules in `index.css`; **fourteen buttons on classes that had no CSS**
  (`btn-primary`, `btn-small`, `button-secondary` — My Work, Awaiting review, Review actions, the
  extension control, the Deliverables tabs) rendering as the browser's grey default; and ~40 bare
  `<button>`s (every dialog's submit, the page-level "add" buttons) styled by nothing. Built:
  `src/components/Button.tsx` — `Button` (`primary` / `secondary` / `danger` / `link`, `md` / `sm`,
  `busy`, `icon`, `to` for a router link), `IconButton` (label required — it is the accessible name
  and the tooltip; red only on hover), `DeleteButton` (bin at rest, small red confirm once armed —
  ONE element so focus survives the arming press), `buttonClass()` for the three `<a download>`s and
  the upload `<label>`; `src/components/Icon.tsx` the action icons on `NavIcon`'s drawing rules.
  `BusyButton` folded in. Every page swept; the five duplicate CSS rules and every `.link-button`
  override deleted; `E2EV1.pen` gains ButtonSecondary/Danger/Link, IconButton and the armed
  DeleteButton beside ButtonPrimary (repo and .pen aligned — Edward's rule). **The rule, after
  Edward's first look at the preview (*"all I can see are nav links"*): `link` is for NAVIGATION and
  view toggles only — open a row, show all, clear a filter, a thing's name. Anything that writes is a
  button:** the `/deliverables` transitions are `primary` (start, submit, approve, mark delivered),
  `secondary` + undo (reopen, unblock), `secondary` + archive, `danger` (cancel job); the Campaigns
  list's Open / Promote / Close out / Reopen / Resume are small buttons; admin activate/deactivate,
  Permissions, Send reset, template Edit/Assign, comment resolve, Keep, Confirm, Mark all read, the
  owner Change and "Change promised date" are small secondary buttons; Download is an icon. Not
  touched: tabs, the schedule zoom group, the chat rail, the auth screens — each its own component,
  a later pass. Gates: typecheck, `npm test` 137 files / 2185, lint 17 pre-existing, build.
- [x] `I48.33` **"Changes requested" never shows on My Work for a task-level round.** Found writing
  the how-to guides (14 Sep): after a reviewer requests changes, the maker's row reads exactly as a
  fresh task — the button says **Deliverable**, not *Review feedback*, and there is no *Changes
  requested* mark. `MyWorkPanel.changesRequested` keys off `item.revisionRound`, which is the
  DELIVERABLE's `revision_round` (ADR-0025 tier-2 versioning) — and the sub-task review cycle
  (ADR-0058: the sub-task is the unit of review) never increments it: both v1 and v2 of the task
  were `media_records.round = 1`, `deliverables.revision_round` stayed 0. The maker IS notified
  (`changes_requested`) and the feedback modal works; only the list is blind. **Dug further, 14 Sep:
  the per-task counter already exists** — `sub_task_request_changes` does `revision_number =
  revision_number + 1` on the task, and `task_time_entries.round` already uses it. What is keyed
  to the DELIVERABLE's `revision_round` instead: `app.task_review_round` (`coalesce(d.revision_round,
  st.revision_number) + 1`), the `media_records` round stamp (`tg_media_record_stamp_round`), the
  `review_feedback` round stamp, and `app.sub_task_submit`'s "this round must carry a version" gate.
  The deliverable's round increments only on the CONTAINER's own in_review → in_progress transition
  (the ADR-0025 tier-2 review that ADR-0058/0077 made unnecessary — `I40.25`), which a task-level
  request-changes never fires. So for every task under a deliverable: every round is "round 1", a
  second-round upload is stamped round 1, **the submit gate is satisfied by LAST round's file** (the
  guide's "a file every round" rule is not enforced), the panel's *upload this round's version*
  line never shows, and *Changes requested* never shows. **The fix is one decision — the round of a
  task is the task's `revision_number`, per ADR-0058 — and one migration:** `task_review_round` reads
  `st.revision_number + 1` whenever `sub_task_id` is set; the media stamp and the submit gate use it;
  `useMyAssignedWork` reads `revision_number`. pgTAP for: request-changes then submit without a new
  upload is refused; v2 stamped round 2; the panel shows *Review feedback*. Frontend-only would break
  the submit gate (the panel would wait for a round-2 version the trigger never stamps) — do it
  whole. Reversible. **Done 14 Sep (Edward: "as per recommendation") — ADR-0058 addendum d.13–d.17,
  migration `20260914150000` (four functions re-emitted whole; a by-time backfill of misstamped
  rounds), pgTAP 115 (send-back → submit without a new upload refused → v2 stamped round 2 → submits;
  047 passes unedited), `useMyAssignedWork` reads `revision_number`, and `MyWorkPanel` narrows its
  version check to THIS task (a sibling's round-2 upload was enabling Submit for a round the server
  refuses). Verified on the local stack: *Review feedback* on the row, *upload this round's version*
  in the dialog, v2 under ROUND 2. Guides 7/8 re-shot.**
- [x] `I48.34` **Two copy gaps found by the guides.** (a) The single-job review step shows
  *Deliverable type —* (blank) while the badge beside the title says SOCIAL ADVERTISEMENT — the
  field reads a different source from the badge. (b) The wizard's step-1 hint says *"Only the
  Account Director or assigned Account Manager can approve this campaign"*, but `approve_campaign`
  lets Traffic and the Power Admin stand in (Edward, 13 Sep: they are the fallbacks) — Traffic
  approved the guide's own campaign. Say what the system does. (Fixed in the same pass: the
  timing-step intro still said *"only a date after go-live is refused"* after ADR-0093 — EN + AR.)
  **Fixed 14 Sep:** (a) `nextFromRequest` seeds the brief's `deliverableType` field from the picked
  type's name when the field is empty (the AM can overwrite it on the brief step); (b) the hint
  now reads *"…approves this campaign; Traffic and the Power Admin can stand in"*, EN + AR. Also in
  the same change: the review dialog's *Request changes* is a button (missed by `I48.32`), and
  `UsersPage.tsx` no longer holds a literal NUL (`let prev = ' '`) that made git treat it as
  binary.
- [x] `I48.35` **A deliverable nobody Started never signs itself off.** Found writing guide 10:
  the guide's own deliverable had all four tasks `done` and still read *Draft · 4 of 4 tasks done*.
  `app.maybe_complete_sub_task` closes the container only when `v_state in ('in_progress',
  'in_review')`, and nothing moves a deliverable out of `draft` except a person pressing **Start**
  (the retest specs press it before approving, which is why K2 never saw this). Starting a task
  does not start its container. ADR-0077's point was that sign-off is a consequence with no
  authority of its own; a container that stays Draft because a button was not pressed defeats it.
  Two shapes: (a) `sub_task_start` (or the assignment) moves a `draft` container to `in_progress`;
  (b) the close check accepts `draft` too. (a) also makes *In progress* mean something. **Done 14 Sep
  (Edward: any task's Start, not just the first):** ADR-0077 addendum d.7–d.9; migration
  `20260914160000` re-emits `sub_task_start` (a still-draft container moves to in_progress) and the
  transition guard (draft → in_progress needs no authority once a task under it has started); a
  one-time move of the rows already stuck; pgTAP 116 (a bare team member starts the SECOND task →
  In progress; the last approval signs it off with nobody pressing Start; a sibling with no started
  task stays Draft). Applied locally: the guide's deliverable went draft → approved by the backfill.
- [x] `I48.38` **PRODUCTION — a request captured by someone who is not the client's account manager
  loses its evidence, and the refusal at approval does not say who the account manager is.** Edward,
  15 Sep, from a real user on `main` (job *programmers syndict campagin*, client Engaz). What
  happened, from the data: the first attempt (07:25) was by a user who was NOT Engaz's AM. The draft
  job was created, the request text saved, but the receipt row was refused — `campaign_brief_receipts`
  is fenced to the client's AM by `in_write_scope(null, null, campaign_account_manager)` (inferred
  from the policy; the dialog said only *"the evidence could not be saved"* — `I48.39`). The user
  carried on to approval, where `approve_campaign` refused with *"outside your reach. Its account
  manager can"* — naming nobody. The second attempt (07:33, once the AM question was settled) saved
  everything: request text, receipt, PNG in the Library (asset `444277e6`, 245 KB, object key set).
  Retest B4 never saw this — it runs as the client's own AM. Three pieces: `I48.39` (the email
  says why), `I48.40` (the decision), `I48.41` (the spinner). **All built 15 Sep** on branch
  `intake-capture-fixes`; retest Section P (`p-capture-and-add-task.spec.ts`) reproduces the
  production case as `am2` on a Northwind job and proves the new behaviour end to end.
- [x] `I48.39` **A reported error carries the real cause.** ADR-0092 d.3 promised the admin email
  "the message, any error code, what the user was doing" — `report-error` and `ReportErrorButton`
  accept a code and context, but no screen passes the underlying error: `failSystem(t(...))` drops
  the cause and the email arrives with the friendly sentence alone (seen 15 Sep, `I48.38`). Fix:
  every reportable error keeps its cause (code, technical message, PostgREST details/hint) and the
  dialog passes it through; the console line is no longer the only record. **Built 15 Sep:**
  `describeCause` (`lib/errors/report.ts`) renders code · message · detail · hint; `NoticeDialog`
  takes `reportCause`; `report-error` gains an optional `cause` and prints it (**redeploy the
  function** — an older function drops the field silently, nothing breaks); every reportable site
  (the wizard, campaigns list, brand dialog, the deliverables banner) passes the thrown error. Also
  found: an alert raised from inside another dialog sat BEHIND it (same z-index) — its Report button
  unreachable; `.notice-backdrop` now sits a layer above. Retest P3.
- [x] `I48.40` **Anyone who may open a request captures ALL of it; the account manager approves.**
  Edward, 15 Sep: *"everything should save until either the AM changed or the existing AM
  approves"*, and the refusal at approval must NAME the account manager. Today the draft and the
  request text save for a non-AM but the receipt (evidence) is refused by RLS, and the approval
  refusal is anonymous. Needs an ADR-0083/0085 addendum: the receipt's write rule follows the
  draft's (whoever could create the job records its evidence), the approval stays the AM's
  (ADR-0085), the refusal names them, and the job is left resumable for the AM. **Edward chose
  option A, 15 Sep — ADR-0083 addendum d.13–d.16, accepted.** Built: `20260915120000` (the receipts
  policy follows `campaigns_tenant_write`; `app.approve_campaign` reproduced whole with the AM's name
  in the refusal's DETAIL), pgTAP 119 (087 stands unedited); `approveScopeNamed` /
  `approveScopeNoManager` EN+AR; guide 3. The addendum also records the 3 Sep widening
  (`20260903150000`) as far as capture goes — the decision record `I37.5`'s note said was missing.
- [x] `I48.41` **Next waits while the evidence files, with a please-wait.** The receipt filing on
  SJ-02 → SJ-03 is fire-and-forget (`void recordReceipt`) so the step changes at once and the
  upload has no spinner; a failure arrives as a dialog over the NEXT step, and pressing Back/Next
  re-runs it and shows the same dialog again — which is what "the error showed on the second
  attempt" most likely was. **ADR-0092 d.1 already decides this** ("every upload" gets the
  please-wait) — this surface was missed in the 13 Sep build, not left open. **Built 15 Sep:**
  `nextFromRequest` awaits `recordReceipt` under `sj-busy-request` ("Saving the request and filing
  the evidence…"); a failure now arrives on the step it belongs to, once. Retest P1.
- [x] `I48.42` **PRODUCTION — the owner cannot add a task to their deliverable's list: "New row
  violates row-level security policies for table sub_tasks", raw, with no Report button.** Edward,
  15 Sep, from a real user. Cause (inferred from the policy, to be proved by pgTAP):
  `sub_tasks_manage_insert` checks `in_write_scope(department_id, team_id, AM)` on the ROW, and the
  add form writes the ASSIGNEE's department — null when the task is added unassigned — so a
  department- or team-scoped owner (ADR-0083 d.11/d.12, ADR-0090 d.7) is refused on their own list;
  the null-argument trap (traps.md) once more. Materialised tasks carry the deliverable's
  department and are fine, which is why retest F never saw it (nobody adds a task by the form as the
  owner). Fix: `save_sub_task` defaults a new task's department to its deliverable's when none is
  given; the refusal is worded ("outside your reach"), and it reports (`I48.39`). **Built 15 Sep:**
  `20260915130000` (`save_sub_task` reproduced whole; a null department is filled from the
  deliverable on INSERT only), pgTAP 120 (the owner and a team lead of the department pass; another
  department's lead is still refused; a named department still wins); `classifyWriteFailure`
  (`lib/errors/classify.ts`) words every deliverables-page failure by code — 42501 → "outside your
  reach", 22023/P0002 → the RPC's own sentence, else the fallback with Report and the cause — and
  the raw `err.message` helper is gone. Guide 5. Retest P2. traps.md: fifth `in_write_scope` row.
- [x] `I48.37` **A send-back waits for the optional answers too.** Edward, 15 Sep, reviewing guide
  8 against the product: *"both feedback and approval should be blocked… far more efficient to have
  one consolidated round of feedback rather than multiple different rounds from individuals."*
  Reverses the second half of ADR-0089 d.6 (addendum d.14–d.16). Migration `20260915100000`
  re-emits `sub_task_request_changes` with the same 55089 gate as the approval (the caller's own
  row never holds it — the press is their answer; only OPTIONAL answers gate, not a second required
  approval); `sendBackWaitsFor` + `ReviewActions` disable the button on the same condition; the
  waiting line reads *"approve or request changes"* (EN + AR); pgTAP 117 (097's send-back stands
  unedited — its optional had answered); unit tests updated. Guide 8 re-shot. Applied locally, NOT
  yet on production.
- [x] `I48.36` **Two lines that do not wrap.** (a) The extension decision on a task row (the
  deliverable's task list) renders the request line, the arithmetic, the note field and the
  buttons on ONE line inside the Due cell — the table stretches off the dialog and the other columns
  are pushed out of view. (b) The promised-date dialog's *After go-live* warning runs past the
  dialog's edge instead of wrapping. Both are `white-space`/width on the `cell-warn` line inside a
  fixed-width container. Cosmetic; seen in guide 9's screenshots. **Fixed 14 Sep:** `.cell-warn`
  keeps `nowrap` for the short cell uses; the sentence uses (`.due-warning`, and inside
  `.extension-control` / `.extension-decision`) wrap, and the decision control is a wrapping flex
  row — arithmetic on its own line, note and buttons after. Guide 9's two pictures re-shot.

- [x] `I48.43` **PRODUCTION — a promoted job cannot have its campaign brief edited or deliverables
  added.** **Closed 20 Sep:** deliverables added and edited on the page since `I52.20`/`I52.21`; the
  brief edited and more deliverables proposed since `I53.4`. Edward, 15 Sep, on `main`. ADR-0086 addendum (11 Sep) sent Promote to the campaign page
  "where an approved campaign gains departments and deliverables" — but the page cannot: the master
  brief is a `BriefReader` (read-only) and *Add deliverable* exists only in the wizard
  (`BriefWizard.tsx`), which resumes DRAFTS only (`useCampaignDraft` filters on status) and whose
  submit re-inserts deliverables (`I44.12`). The addendum's sentence was never true in the code. Same
  gap for any approved campaign, promoted or not. Options put to Edward 15 Sep. **Interim (noted
  for Edward, 15 Sep):** the deliverable's OWNER can still be reassigned — Deliverables → open the
  deliverable → *Owner* → **Change** → pick a lead of its department → Save (also on the campaign
  page's department tab; `deliverable_owner:manage` — Traffic, the AM, Power Admin; ADR-0055,
  ADR-0083 d.11/d.12). The brief and the deliverable list cannot be changed until this is built.

### I49 — Every control has a browser test (15 Sep, Edward: "the Playwright tests were completely inadequate")

A user pressed **Add sub-task** on a deliverable and it failed (`I48.42`); no test had ever pressed it. The
retest plan (A–N) listed what each screen SHOWS and walked one chosen path per flow, as the person most
likely to succeed. `scripts/check-e2e-coverage.mjs` now lists every interactive control in `src/` (by
`data-testid`) against every one a spec under `e2e/` presses; **CI fails on any control not in
`e2e/coverage-baseline.json`** (`npm run check:e2e-coverage`). The baseline was the 15 Sep backlog: **433
controls in 64 screens, 621 interactive controls in all** — a third were covered. **By the end of 15 Sep:
38 remain, none reachable** (36 on the three unrouted pages, `I49.79`; 2 on the update bar, `I49.84` — cleared 17 Sep, 36 left). Clear a screen, re-run
`--write-baseline`, tick its line. Worst screens first; the pilot's screens (deliverables, schedule,
the wizard, My Work) before admin. The rule itself wants an `AGENTS.md` sentence, which needs an ADR
(`I49.0`). Eleven spec patterns are too vague to count (`*-save`, `*-dialog`… over a prefix variable) —
those specs should press concrete ids (`I49.1`).

- [x] `I49.0` **The rule, in `AGENTS.md` §testing:** every interactive control has a browser test that
  uses it, as one person who may and one who may not; a refusal is worded and never reportable. Needs a
  short ADR (changes the testing bar). Gate already in CI. **ADR-0095 drafted 17 Sep, accepted 21 Sep
  (Edward: "resolve 6"); the §7 sentence and the index row went in 22 Sep.**
- [ ] `I49.1` **Specs press concrete ids.** `*-list, *-dialog, *-reason, *-approve, *-save, *-note,
  *-error, *-*, *-empty, *-delete-*, *-item-*` are prefix-variable helpers the gate cannot resolve;
  rewrite those references so what they press is named.
- [x] `I49.2` **`src/features/admin/WorkflowTemplatesPage.tsx`** — 28: `workflow-add-form`, `workflow-edit-cancel`, `workflow-edit-name-ar`, `workflow-edit-name-en`, `workflow-edit-save`, `workflow-new-code`, `workflow-new-name-ar`, `workflow-new-name-en`, `workflow-new-submit`, `workflow-open-*`, `workflow-rename-*`, `workflow-step-cancel`, `workflow-step-down-*`, `workflow-step-edit-*`, `workflow-step-edit-ar`, `workflow-step-edit-en`, `workflow-step-edit-hours`, `workflow-step-edit-review-mode`, `workflow-step-new-ar`, `workflow-step-new-en`, `workflow-step-new-hours`, `workflow-step-new-review-mode`, `workflow-step-new-submit`, `workflow-step-remove-*`, `workflow-step-save`, `workflow-step-toggle-*`, `workflow-step-up-*`, `workflow-toggle-*`
- [x] `I49.3` **`src/features/deliverables/DeliverablesPage.tsx`** — 27: `deliverable-filter-*`, `deliverable-filters-clear`, `deliverable-owner-cancel`, `deliverable-unassigned-filter`, `deliverables-campaign`, `deliverables-search-*`, `deliverables-tab-adhoc`, `deliverables-tab-campaign`, `subtask-add-form`, `subtask-assignee`, `subtask-cancel-*`, `subtask-due`, `subtask-edit-*`, `subtask-edit-cancel-*`, `subtask-edit-due-*`, `subtask-edit-review-mode-*`, `subtask-edit-save-*`, `subtask-edit-title-*`, `subtask-hours`, `subtask-move-down-*`, `subtask-move-up-*`, `subtask-reinstate-*`, `subtask-remove-*`, `subtask-request-changes-*`, `subtask-resources-toggle-*`, `subtask-review-mode`, `subtask-sla-profile`
- [x] `I49.4` **`src/features/clients/components/ClientForm.tsx`** — 23: `client-form`, `client-form-accessContact`, `client-form-am`, `client-form-avgOrderValue`, `client-form-bestSellers`, `client-form-cancel`, `client-form-catalogConnection`, `client-form-dailyCapacity`, `client-form-digitalPresence`, `client-form-economics`, `client-form-name`, `client-form-odoo`, `client-form-pastLessons`, `client-form-primaryAction`, `client-form-productCount`, `client-form-returnsRate`, `client-form-salesProcess`, `client-form-seasonality`, `client-form-submit`, `client-form-type-*`, `client-form-userCounts`, `client-form-usp`, `client-form-whatTheySell`
- [x] `I49.5` **`src/features/schedule/SchedulePage.tsx`** — 18: `filter-clear`, `filter-department`, `filter-kind`, `filter-office`, `filter-project`, `filter-team`, `filter-who`, `nav-next`, `nav-prev`, `nav-today`, `new-booking`, `reassign-cancel`, `reassign-confirm-apply`, `schedule-refusal-close`, `view-*`, `zoom-fortnight`, `zoom-month`, `zoom-week`
- [x] `I49.6` **`src/features/admin/ResourcesPage.tsx`** — 17: `resource-approval`, `resource-cancel`, `resource-capacity`, `resource-ceiling`, `resource-charge`, `resource-cost`, `resource-currency`, `resource-department`, `resource-edit-*`, `resource-link-select`, `resource-nickname`, `resource-nickname-reroll`, `resource-pool`, `resource-team`, `resource-toggle-*`, `resource-unlink`, `resource-warn`
- [ ] `I49.7` **`src/features/kpi/KpisPage.tsx`** — 17: `kpi-def-agg`, `kpi-def-form`, `kpi-def-hib`, `kpi-def-name`, `kpi-def-submit`, `kpi-def-unit`, `kpi-rollup-end`, `kpi-rollup-load`, `kpi-rollup-start`, `kpi-target-actual`, `kpi-target-def`, `kpi-target-end`, `kpi-target-form`, `kpi-target-start`, `kpi-target-submit`, `kpi-target-target`, `kpi-target-user`
- [x] `I49.8` **`src/features/admin/OrganizationPage.tsx`** — 16: `dept-add-form`, `dept-add-name`, `dept-add-submit`, `dept-delete-*`, `dept-edit-*`, `dept-rename-*`, `office-add`, `office-delete-*`, `office-edit-*`, `team-add-department`, `team-add-form`, `team-add-name`, `team-add-submit`, `team-delete-*`, `team-edit-*`, `team-rename-*`
- [x] `I49.9` **`src/features/admin/components/InviteUserDialog.tsx`** — 14: `invite-as-resource`, `invite-cancel`, `invite-department`, `invite-dialog`, `invite-email`, `invite-job-title`, `invite-locale`, `invite-name`, `invite-nickname`, `invite-nickname-reroll`, `invite-office`, `invite-role`, `invite-submit`, `invite-team`
- [x] `I49.10` **`src/features/admin/UsersPage.tsx`** — 14: `department-*`, `invite-open`, `office-*`, `perms-*`, `reset-*`, `role-*`, `team-*`, `toggle-active-*`, `users-filter-clear`, `users-filter-department`, `users-filter-office`, `users-filter-role`, `users-filter-search`, `users-filter-team`
- [x] `I49.11` **`src/features/campaigns/BriefWizard.tsx`** — 13: `wizard-add-deliverable`, `wizard-cancel`, `wizard-commence-*`, `wizard-deliverable-category-*`, `wizard-deliverable-channel-*`, `wizard-deliverable-format-*`, `wizard-deliverable-name-*`, `wizard-deliverable-qty-*`, `wizard-deliverable-remove-*`, `wizard-deliverable-type-*`, `wizard-filled-confirm-*`, `wizard-not-draft-open`, `wizard-perf-*`
- [x] `I49.12` **`src/features/admin/BriefTemplatesPage.tsx`** — 12: `brief-template-assign-*-*`, `brief-template-assign-open-*`, `brief-template-cancel`, `brief-template-default-*-*`, `brief-template-edit-*`, `brief-template-field-ar-*`, `brief-template-field-en-*`, `brief-template-field-guidance-*`, `brief-template-field-remove-*`, `brief-template-new-name`, `brief-template-new-submit`, `brief-template-save`
- [x] `I49.13` **`src/features/admin/RolesPage.tsx`** — 12: `grant-*-*`, `role-archive`, `role-create-open`, `role-default-route`, `role-description`, `role-detail-form`, `role-item-*`, `role-name`, `role-reach-cancel`, `role-reach-confirm-save`, `role-save`, `role-scope`
- [x] `I49.14` **`src/features/admin/DeliverableTypesPage.tsx`** — 11: `attribute-picker`, `attribute-toggle-*`, `type-edit-*`, `type-edit-cancel`, `type-edit-name-ar`, `type-edit-name-en`, `type-edit-save`, `type-filter-category`, `type-search`, `type-toggle-*`, `type-workflow-*`
- [x] `I49.15` **`src/features/deliverables/ReviewPanel.tsx`** — 11: `comment-jump-*`, `comment-resolve-*`, `review-composer`, `review-download`, `review-download-inline`, `review-drop-time`, `review-external`, `review-mark-time`, `review-page-anchor`, `review-page-input`, `review-upload`
- [ ] `I49.16` **`src/features/internal/InternalProjectPage.tsx`** — 11: `internal-add-deliverable`, `internal-cancel`, `internal-deliverable-name-*`, `internal-deliverable-remove-*`, `internal-department`, `internal-form`, `internal-name`, `internal-owner-*`, `internal-pm`, `internal-submit`, `internal-team`
- [x] `I49.17` **`src/features/schedule/components/EditBookingDialog.tsx`** — 11: `edit-assignee`, `edit-cancel-booking`, `edit-cancel-task`, `edit-close`, `edit-end-date`, `edit-hours`, `edit-notes`, `edit-resource`, `edit-review-mode`, `edit-title`, `edit-withdraw-request`
- [x] `I49.18` **`src/features/clients/ClientsPage.tsx`** — 10: `brand-add-client`, `brand-add-form`, `brand-add-name`, `brand-add-submit`, `brand-delete-*`, `brand-edit-*`, `brand-rename-*`, `client-delete-*`, `client-edit-*`, `client-register`
- [x] `I49.19` **`src/features/auth/SetPasswordPage.tsx`** — 9: `set-password-back`, `set-password-code`, `set-password-confirm`, `set-password-email`, `set-password-form`, `set-password-input`, `set-password-resend`, `set-password-submit`, `set-password-toggle`
- [x] `I49.20` **`src/features/library/LibraryPage.tsx`** — 9: `asset-download-*`, `asset-file-input`, `asset-upload`, `folder-delete-*`, `library-client`, `library-mode-browse`, `library-mode-search`, `library-search-input`, `search-download-*`
- [ ] `I49.21` **`src/features/admin/AdminHome.tsx`** — 8: `admin-card-audit`, `admin-card-deliverable-types`, `admin-card-feedback`, `admin-card-organization`, `admin-card-resources`, `admin-card-roles`, `admin-card-users`, `admin-card-workflow-templates`
- [x] `I49.22` **`src/features/admin/components/NewRoleDialog.tsx`** — 8: `new-role-cancel`, `new-role-copy`, `new-role-description`, `new-role-dialog`, `new-role-name`, `new-role-route`, `new-role-scope`, `new-role-submit`
- [x] `I49.23` **`src/app/DevPanel.tsx`** — 7: `dev-apply`, `dev-close`, `dev-department`, `dev-exit`, `dev-fab`, `dev-role`, `dev-team`
- [x] `I49.24` **`src/features/sla/SlaProfilesPage.tsx`** — 7: `sla-cancel`, `sla-default`, `sla-edit-*`, `sla-form`, `sla-hours`, `sla-name`, `sla-submit`
- [x] `I49.25` **`src/features/admin/components/OfficeDialog.tsx`** — 6: `office-cancel`, `office-day-*`, `office-dialog`, `office-name`, `office-submit`, `office-timezone`
- [x] `I49.26` **`src/features/campaigns/components/ReviewStep.tsx`** — 6: `review-edit-brief`, `review-edit-deliverables`, `review-generate-*`, `review-tab-*`, `review-tab-all`, `review-tab-campaign`
- [x] `I49.27` **`src/features/deliverables/components/ExternalInputs.tsx`** — 6: `external-input-add`, `external-input-awaited-from`, `external-input-description`, `external-input-form`, `external-input-save`, `external-input-toggle-*`
- [x] `I49.28` **`src/features/feedback/components/SendFeedbackDialog.tsx`** — 6: `feedback-cancel`, `feedback-category`, `feedback-close`, `feedback-dialog`, `feedback-message`, `feedback-submit`
- [x] `I49.29` **`src/features/leave/LeaveDialog.tsx`** — 6: `leave-category`, `leave-end`, `leave-reason`, `leave-resource`, `leave-start`, `leave-submit`
- [x] `I49.30` **`src/features/admin/AuditPage.tsx`** — 5: `audit-clear`, `audit-entity-filter`, `audit-from`, `audit-more`, `audit-to`
- [x] `I49.31` **`src/features/admin/components/UserPermissionsDialog.tsx`** — 5: `override-*-*`, `scope-add`, `scope-pick`, `scope-remove-*`, `user-perms-close`
- [x] `I49.32` **`src/features/deliverables/TaskResources.tsx`** — 5: `task-resource-add-submit`, `task-resource-hours`, `task-resource-picker`, `task-resource-remove-*`, `task-resource-starts-on`
- [x] `I49.33` **`src/features/feedback/FeedbackAdminPage.tsx`** — 5: `feedback-cancel-*`, `feedback-confirm-*`, `feedback-note-*`, `feedback-reopen-*`, `feedback-resolve-*`
- [x] `I49.34` **`src/features/bookings/BookingsPage.tsx`** — 4: `range-from`, `range-to`, `tab-all`, `tab-project`
- [x] `I49.35` **`src/features/bookings/BookingsTable.tsx`** — 4: `bookings-export`, `bookings-group`, `bookings-search`, `col-*`
- [x] `I49.36` **`src/features/campaigns/CampaignPage.tsx`** — 4: `*-edit`, `campaign-approve`, `campaign-deliverable-open-*`, `campaign-open-deliverable`
- [x] `I49.37` **`src/features/chat/ChatPage.tsx`** — 4: `chat-archived-toggle`, `chat-group-toggle-*`, `chat-rail-*`, `chat-search`
- [x] `I49.38` **`src/features/chat/ConversationMembers.tsx`** — 4: `chat-add-member`, `chat-add-member-select`, `chat-add-member-submit`, `chat-member-remove-*`
- [x] `I49.39` **`src/features/intake/components/RequestStep.tsx`** — 4: `sj-channel`, `sj-format`, `sj-quantity`, `sj-source`
- [x] `I49.40` **`src/app/AppShell.tsx`** — 3: `feedback-open`, `nav-dashboard`, `preview-banner-exit`
- [x] `I49.41` **`src/components/FolderPicker.tsx`** — 3: `*-add-form`, `*-add-name`, `*-crumb-*`
- [x] `I49.42` **`src/features/auth/LoginPage.tsx`** — 3: `forgot-back`, `forgot-toggle`, `login-remember`
- [x] `I49.43` **`src/features/campaigns/components/BriefReceiptPanel.tsx`** — 3: `receipt-choose`, `receipt-subject`, `receipt-timezone`
- [x] `I49.44` **`src/features/chat/ChatPanel.tsx`** — 3: `chat-composer`, `chat-input`, `chat-retry-*`
- [x] `I49.45` **`src/features/deliverables/components/RequiredInput.tsx`** — 3: `requirement-add-*`, `requirement-picker-*`, `requirement-remove-*`
- [x] `I49.46` **`src/features/leave/LeavePage.tsx`** — 3: `closure-edit-*`, `leave-delete-*`, `leave-edit-*`
- [ ] `I49.47` **`src/app/UpdateBar.tsx`** — 2: `update-bar-dismiss`, `update-bar-reload`
- [x] `I49.48` **`src/features/attendance/AttendanceWidget.tsx`** — 2: `attendance-end`, `attendance-start`
- [x] `I49.49` **`src/features/campaigns/CampaignsPage.tsx`** — 2: `campaign-job-continue-*`, `campaign-open-*`
- [x] `I49.50` **`src/features/campaigns/components/BriefIngestPanel.tsx`** — 2: `brief-ingest-choose`, `brief-ingest-file`
- [x] `I49.51` **`src/features/deliverables/PipelinePage.tsx`** — 2: `pipeline-campaign`, `pipeline-card-*`
- [x] `I49.52` **`src/features/deliverables/TaskReviewThread.tsx`** — 2: `task-comment-resolve-*`, `task-review-composer-*`
- [x] `I49.53` **`src/app/guards.tsx`** — 1: `permissions-retry`
- [x] `I49.54` **`src/components/Field.tsx`** — 1: `…`
- [x] `I49.55` **`src/features/bookings/ProjectTasks.tsx`** — 1: `project-select`
- [x] `I49.56` **`src/features/campaigns/components/DocumentFiling.tsx`** — 1: `*-choose`
- [x] `I49.57` **`src/features/deliverables/components/ExtensionControl.tsx`** — 1: `*-withdraw`
- [x] `I49.58` **`src/features/deliverables/components/TaskListApproval.tsx`** — 1: `task-list-risk-dismiss`
- [x] `I49.59` **`src/features/deliverables/MyWorkPanel.tsx`** — 1: `my-work-open-*`
- [x] `I49.60` **`src/features/directory/DirectoryPage.tsx`** — 1: `directory-search`
- [x] `I49.61` **`src/features/intake/components/NewRequestDoor.tsx`** — 1: `new-request-close`
- [x] `I49.62` **`src/features/intake/components/SimilarJobsDialog.tsx`** — 1: `sj-similar-open-*`
- [x] `I49.63` **`src/features/intake/SingleJobWizard.tsx`** — 1: `sj-released-open`
- [x] `I49.64` **`src/features/leave/ClosureDialog.tsx`** — 1: `closure-cancel`
- [x] `I49.65` **`src/features/team/TeamPage.tsx`** — 1: `team-scope-toggle`
- [x] `I49.3`/`I49.32` **done 15 Sep** — `e2e/local/coverage/deliverables-page.spec.ts` (7 tests, 27 + 5
  controls; `lead` may, `content` may not, `writer` is not offered the page; every outcome read back
  from the database). Baseline 433 → 400. **It found two defects and one wording gap on its first run:**
- [x] `I49.66` **An outsider editing a task is told "sub_task … not found".** **Fixed 16 Sep (option A, Edward's wording):** `20260916110000` — when the RLS-filtered UPDATE finds no row but the caller can see it, `save_sub_task` raises 42501 "you do not have the rights to edit this task" with the deliverable owner's name in DETAIL (hint `deliverable_owner` / `no_owner`); a missing row is still P0002. The page says "You do not have the rights to edit this task. If it needs editing, please contact the deliverable's owner, <name>." (EN/AR), no Report. pgTAP 122; the coverage spec asserts the sentence and the name. `save_sub_task`'s UPDATE
  is filtered by RLS to zero rows and the function raises P0002 — to a person who can SEE the row.
  Should be 42501 "outside your reach" like every other refusal: check existence with the tenant-wide
  select first, then raise on scope. The coverage spec asserts only "not the database's sentence"
  until this lands.
- [x] `I49.67` **A task that was cancelled and then reinstated cannot be removed.** **Fixed 16 Sep (option A):** `20260916100000` — `remove_sub_task`'s plan predicate gains "nothing in the SLA log": a task the log has recorded (a commitment stamped on assignment, a deadline moved) is CANCELLED by Remove, its record kept; a task with no record is still deleted. `fetchCancelImpact` reads the same predicate, the notice says "its record is kept because it has history" (EN/AR). pgTAP 121; the held browser test now runs in the cancel/reinstate flow. (The log rows on the failing task were `deadline_set`/`deadline_changed`, not the cancel/reinstate events — the principle is the same.) Reinstate leaves it
  unassigned + todo (ADR-0068 d.5), so `remove_sub_task` takes the PLAN branch and deletes — but the
  cancel/reinstate rows in `sla_events` reference it (`fk_sla_events_sub_task_tenant`, no cascade, and
  the log is append-only by design), so the delete is refused 23503 and the person sees "That action
  could not be completed" with a Report button. Fix: a task with ANY log row is history, not a plan
  → cancel, never delete (add `exists (select 1 from sla_events …)` to the plan predicate; ADR-0052
  d.12/d.13's "never worked" read as "never recorded"). `test.fixme` in the coverage spec until then.
- [x] `I49.68` **A 55000 refusal read as a system failure.** "a change description is required to
  request changes" (and 32 other `errcode 55000` sentences) went through `classifyWriteFailure`'s
  fallback — "That action could not be completed" plus a Report button — instead of being shown as
  the instruction it is. Fixed 15 Sep in the classifier (55000 joins 22023/P0002); unit test.
- [x] `I49.5`/`I49.17` **done 15 Sep** — `e2e/local/coverage/schedule-page.spec.ts` (6 tests + 2 held; 18 + 11
  controls; `traffic` may, `tl` requests, `maker` is refused in words). Baseline 400 → 371. **Found:**
- [x] `I49.69` **The edit-booking dialog carries a dead branch** — **closed 16 Sep: the premise was wrong.**
  `edit-resource`, `edit-notes` and `edit-cancel-booking` are the plain-reservation branch, and
  `BookingDialog.tsx:388` still creates plain reservations on equipment and rooms (only a PERSON is
  forced through a task, ADR-0035). The branch is live and UNTESTED — the coverage gate counted it
  covered because the spec names the ids to assert they are absent on a task booking. Under
  ADR-0094 it is the booker's and owner's edit; its browser test is `I50.7`.
- [x] `I49.70` **"+ New booking" is offered to a team member** — **fixed 16 Sep (option A):** the button is gated on `bookings:create` (shown until the grants are known, as the cell's + is); the held test runs. Was: who holds no `bookings:create`; the
  dialog opens and the database refuses. Role leakage (AGENTS.md): the button must be gated on the
  grant, like the `+` on a cell already is. `test.fixme` in the spec.
- [x] `I49.71` **The schedule's PROJECT view never shows anyone — and never has.** **Fixed 16 Sep (option A):** the campaign is worked out on read — booking → deliverable → stream → campaign — in `useScheduleBookings` and the Bookings page's list and project rollup (`deliverables.streams` embeds; the rollup filters on the inner join). `bookings.campaign_id` stays as a fallback only. History repaired for free; the held tests in `schedule-page.spec.ts` and `people-chat-library-bookings.spec.ts` now run. It lists the people
  whose bookings carry the project, and `bookings.campaign_id` is NULL on every booking in the database
  (0 of 213 locally; nothing writes it — not `subtask-schedule`, not the dialogs, not a trigger). The
  view and the *Project* filter are dead on production too (inferred: same code, same writers). Fix:
  derive the campaign on read from deliverable → stream (one join in `useBookings`), or stamp it on
  write with a trigger; the read-side derivation also repairs history. `test.fixme` in the spec.
- [x] `I49.11`/`I49.49`/`I49.50`/`I49.43`/`I49.56` **done 15 Sep** — `e2e/local/coverage/campaign-wizard.spec.ts`
  (7 tests + 1 held: the wizard's five steps with every deliverable field, add/remove a row, the brief
  from a FILE with Confirm, the performance fields, the receipt's Choose/subject/timezone, attachments,
  the review tabs and both Edit buttons, Cancel + resume from the list, a colleague's submit left
  pending and approved on the page by the AM, the not-a-draft guard, the list's Continue and Open;
  `maker` is not offered the wizard). `CampaignPage` and `ReviewStep` each keep ONE control — see
  `I49.74`. Baseline 371 → 342. **Found:**
- [x] `I49.72` **A refused approval in the CAMPAIGN wizard vanishes.** **Fixed 16 Sep (option A):** a reach refusal (42501) is held in `approvalRefused` and rendered as its own screen — the sentence naming the account manager (DETAIL) or saying there is none (HINT), "saved and waiting", and Open the campaign — before the draft query can swap in the not-a-draft notice. Same reading as the single-job wizard. `campaigns.review.approveScope*` EN/AR. Proven in `campaign-wizard.spec.ts`. A manager who is not the AM
  presses Approve: the submit lands (pending), the approval is refused (42501) — and the draft query
  refetches, the wizard is replaced by "This is no longer a draft… open it from the campaigns list",
  and the refusal is never shown. Nothing names the account manager. ADR-0083 addendum d.15 was
  applied to the single-job wizard only; apply the same sentence here. `test.fixme` in the spec.
- [x] `I49.73` **Step 2 of the campaign wizard refuses without naming the field.** **Fixed 16 Sep (option A):** a refused Next says "Please fill in The proposition before continuing" (step 1 names client / campaign name / account manager the same way) and the field is outlined with "Required before continuing" under it until it is filled. `campaigns.wizard.incompleteNamed` / `fieldRequired` EN/AR; unit test; the coverage spec asserts the name and the mark. "Please complete the
  required fields before continuing." The single-job request names each missing field (`I44.15`,
  Edward B1); the campaign wizard should too (the proposition was the one missing).
- [ ] `I49.74` **Three controls are unreachable on the local stack because no department has a default
  brief template:** `review-tab-<dept>` / `review-generate-<dept>` on the wizard's review step and the
  department brief's `-edit` on the campaign page all need a generated department brief, and the seed
  assigns no template ("No brief template is assigned to Creative, Content"). Seed one per department
  in `supabase/seed.sql` — which is also the open Waiting-on-Edward question (do Creative and Content
  get a default template?). **Covered 15 Sep another way:** the brief-templates coverage spec makes its
  own template the default for Creative and Content through the admin screen, and runs first; the
  wizard and campaign-page specs then press all three by id. The seed question stays open.
- [x] **done 15 Sep — the review panel and the rest of the work surfaces** —
  `e2e/local/coverage/review-and-my-work.spec.ts` (5 tests: an outside input added with every field,
  marked arrived and reopened; a task's requirement picked, added, removed; the review panel's Upload
  label with video / PDF / other / image versions, the time and page anchors, a comment jumped to and
  resolved, Download and the read-only panel; the manual thread's Resolve; ask-for-more-time then
  Withdraw; the Pipeline's picker and a card; a single job's risk reminder dismissed; the released-job
  and lookalike Open buttons). Baseline 342 → 313. **Found:**
- [x] `I49.75` **My Work fails outright for a person with ~200+ live tasks.** **Fixed 15 Sep:** the four
  reads that named every task in one address (reviewers, extension events, pending assignment
  requests, dependencies) go through `src/lib/query/in-chunks.ts` in batches of 100; NOT an embed —
  the reviewers read's own note says an embed over that composite key comes back silently empty.
  Proven by `e2e/local/coverage/my-work-at-scale.spec.ts` on the maker (234 live tasks). The assigned-work read
  fetches the reviewers with `.in('sub_task_id', <every id>)` in ONE GET; at ~9 KB of ids Kong
  answers **414 URI Too Long** and the page says "Could not load your assigned work". Reproduced
  locally on the seeded maker (247 live tasks after two days of runs); the same shape is in
  `extensions-api` (`.in('sub_task_id', …)`) and `requirements-api`. Not yet reachable in the pilot
  (nobody holds that many), but a time bomb. Fix: chunk id lists (≤ 100 per call) in one helper, or
  embed the reviewers in the task select. The coverage spec uses the deputy meanwhile.
- [x] `I49.76` **Harness: a stored Playwright session older than an hour fails every read as anon.**
  `auth.setup.ts` reused `e2e/.auth/<tag>.json` forever; eleven hours in, the refresh token had been
  rotated and My Work showed "Could not load" for no reason a test could see. Now re-logs in after
  60 minutes. (Not a product defect — traps.md not needed, the setup comment carries it.)
- [x] **done 15 Sep — people, chat, library, bookings** — `e2e/local/coverage/people-chat-library-bookings.spec.ts`
  (5 tests: the request step's source/quantity/channel/format carried into the draft, the Ctrl/Cmd+P
  door closed; Directory search, Team's scope toggle, attendance start/end; Chat's rail search, a
  thread, a group collapsed, sends by Enter and by button, a member added and removed, the archived
  toggle; the Library's client picker, the folder tree by crumbs, a new folder, Upload (the hidden
  input), Download, the folder deleted, search mode; Bookings' tabs, range, search, grouping, a
  column sort, Export). Baseline 313 → 278. **Found:**
- [x] `I49.77` **The Library shows an EMPTY tree for a client with more than 1,000 folders.** **Fixed 15 Sep (option A):** the tree is read one level at a time — `useFolderView` (the folder, its chain, its children, the children paged past 1,000) replaces `useClientFolders`; the wizards ask for their brand / campaign root by id (`useBrandFolderRoot`, `useCampaignFolderRoot`) and each filing panel reads its own level. Proven by `e2e/local/coverage/library-at-scale.spec.ts` on Northwind (3,000+ folders). The
  client-folders read returns PostgREST's first 1,000 rows (`max_rows = 1000`) and stops; the client
  root is not among them and the Library says "No files in this folder yet" with no tree. Locally
  Northwind has 2,588 folders (every test campaign provisions five); a real client reaches it at ~200
  campaigns. The wizard's filing tree reads the same way. Fix: page the read, or load the root and
  its children lazily. The spec uses Harbour Line meanwhile.
- [x] `I49.78` **Directory: the count ignores the search.** **Fixed 16 Sep (option A):** "3 of 20 people" while a search is on, the whole count when it is cleared (`directory.countOf` EN/AR); the directory test asserts both. "20 people" stays while the search narrows
  the rows to one; the deliverables page says "n of m shown". Cosmetic.
- [x] **done 15 Sep — clients and leave** — `e2e/local/coverage/clients-and-leave.spec.ts` (2 tests: a
  client registered with every field including the e-commerce and app sections, a registration
  cancelled, the client edited, a brand added / renamed / deleted, the client deleted; a leave entry
  with every field, edited, deleted; a closure declared, edited, deleted, and its dialog cancelled;
  `maker` is offered neither Register nor the Leave page). Baseline 273 → 230.
- [x] **done 15 Sep — admin: organization, users, roles, SLA** — `e2e/local/coverage/admin-org-users-roles.spec.ts`
  (5 tests: a department and a team added / renamed / deleted; an office with its timezone and working
  days, edited, cancelled, deleted; every Users filter and Clear; an invite with every field, the
  nickname reroll, Cancel, then a real invite (the profile, the resource row and the Mailpit mail
  checked); role / department / team / office changed on the row; a permission override flipped and
  inherited back, a scope grant added and removed; a password reset (the mail); deactivate (armed
  twice) and reactivate; a new role with every field, edited, a grant toggled, a reach widening with
  its confirmation cancelled then saved, archived; an SLA profile whose second default is refused in
  words, created, an edit cancelled, edited; `lead` is offered none of the admin pages). Baseline
  230 → 150.
- [x] **done 15 Sep — admin catalogues, feedback, the shell** —
  `e2e/local/coverage/admin-catalogues-feedback-shell.spec.ts` (7 tests: a workflow template with two
  steps carrying every field, renamed (cancel, save), a step edited, reordered, toggled, removed, the
  template toggled; an equipment resource with every field including the rates, cancelled then created,
  edited, its toggle armed and confirmed, a person's login unlinked and linked; a brief template created,
  its fields relabelled and one removed (cancel, save), assigned to Creative and Content and made the
  default; deliverable types searched and filtered, one edited (cancel, save) with its workflow and
  attribute, toggled; the audit page's filters, range, Clear and More; Send feedback with every field
  and its Cancel / Close; the feedback admin's note, confirm, resolve, reopen, cancel; the shell's nav,
  the dev "view as" panel applied, the preview banner exited both ways; `lead` is offered none of the
  catalogues). Baseline 150 → 57. **Found:**
- [x] `I49.80` **The dev "View as" button floats over the Create button** at the foot of the brief-templates
  page (and any admin page that long): a click on Create opens the dev panel instead. Cosmetic in
  production — the button is Power-Admin only — but real. The specs hide it. **Closed 16 Sep
  (option C — left as is, Edward):** Power Admin only, the coverage specs already hide it; no code
  change. Option A (a bottom margin the button's height) stays available if it bites again.
- [x] `I49.81` **A brief template made on the admin screen can never get a field.** **Fixed 16 Sep (A + B):** (A) an Add-field row at the foot of the editor — EN / AR / guidance, the key made from the English label and shown before it is added, a duplicate key refused in words, an empty template says so; (B) the create form offers "Start from <template>", copying that template's fields (only templates with fields are offered). `useCreateBriefTemplate` takes optional `fields`. EN/AR. Unit tests + the coverage spec, which no longer seeds fields through the service role. The editor relabels
  and removes fields but has no "add field", so a new template stays at 0 fields and is "not offered in
  the wizard until it has fields" for ever — the screen's own note says the person "adds them next",
  and nothing lets them. Fix: an Add-field row in `TemplateEditor` (key, EN, AR, guidance). The
  coverage spec seeds two fields through the service role until then, and says so.
- [x] `I49.82` **The campaign page never sees a department's default brief template.** **Fixed 16 Sep (option A):** `useDepartmentTemplates` now selects the join row's `is_default`; the page's existing logic pre-selects it and enables Generate, the dropdown stays as the override. Proven in `campaign-wizard.spec.ts`. With Creative's
  default set, the Creative tab of an approved campaign still says "No default brief. Select a brief from
  the dropdown" and Generate stays disabled until one is picked by hand. `useDepartmentTemplates`
  selects the join's embedded template but not the join's own `is_default` column, so every template
  reads as not-default. One column in the select. `test.fixme` in the wizard spec.
- [x] **done 15 Sep — the doors** — `e2e/local/coverage/auth-and-shell.spec.ts` (3 tests: Forgot password
  switches the form and Back returns, "remember me" unticked, a forgot request sends the mail and opens the
  code screen with the address, Back to login; an invitee on the set-password page: resend (the mail
  arrives), a mismatched confirmation and a wrong code refused in words, the reveal toggle, the right
  code lets them in, and the new password signs in (a wrong one is refused); the permissions guard when
  the grant read fails, and Retry). Plus `dev-exit`, `override-schedule-view` by name, and the bookings
  Project picker in the earlier specs. Baseline 57 → 38. **Found:**
- [x] `I49.83` **"Remember me" on the login page does nothing.** **Fixed 16 Sep (option A — removed):** the box, its style and its two locale keys are gone; everyone stays signed in until they sign out, as before. The doors spec asserts its absence. The box has no name and nothing reads it;
  ticked or not, the sign-in is identical. Either it keeps the session in the tab only when unticked, or
  it goes. `test.fixme` in the spec.
- [x] `I49.84` **The update bar cannot be reached from the local suite.** `useAppVersion` stops at
  `BUILD_ID === 'dev'`, which the dev server always is, so `update-bar-reload` / `-dismiss` can never
  show under `npm run dev`. **Fixed 17 Sep, not the `vite preview` way** (a second port loses every
  saved login — the bar sits inside the signed-in shell): `playwright.local.config.ts` starts the dev
  server with `E2E_BUILD_ID=e2e-local`, `vite.config.ts` uses it in place of `dev` and answers
  `/version.json` under `serve` too. `coverage/update-bar.spec.ts`: a newer id on the server shows
  the bar, *Not now* hides it, *Reload* reloads; the same id shows nothing. A dev server started by
  hand fails the spec with a sentence saying so. Both ids out of the baseline (36 left, all `I49.79`).
- [x] `I49.85` **The local stack's auth mail carries a link; production's carries a code.** The recovery
  and invite templates were Supabase's defaults locally (`supabase/config.toml` pointed at none), so the
  mail said "Follow the link" and the code screen could not be proven from the mail. **Fixed 17 Sep:**
  the production templates were already in the repo (`supabase/email-templates/`, ADR-0012) — nothing
  to write, only `[auth.email.template.invite]` / `.recovery` in `config.toml` pointing at them
  (subjects stay GoTrue's defaults). `auth-and-shell.spec.ts` now reads the code from the Mailpit
  mail (`codeInMail`) and signs in with it; the admin `generate_link` shortcut is gone. Needs
  `supabase stop && supabase start` once.
- [ ] `I49.79` **Three pages are not routed at all:** `KpisPage` (17 controls), `InternalProjectPage`
  (11) and `AdminHome` (8) exist with unit tests and no route in `router.tsx` — nobody can reach them
  (the internal-project door was removed by ADR-0082 addendum d.4; `/admin` renders the dashboard).
  Route them or delete them; 36 of the remaining baseline controls are theirs and cannot be covered.
  **Parked 17 Sep (Edward): waiting for the design files.**
- [x] `I49.86` **Two coverage specs relied on database state they never made** — found by the 17 Sep
  re-verification on a database reset on 16 Sep. *SLA profiles* expected "already has a default" but
  the seed carries no SLA profile at all (it passed on 15 Sep because that database happened to hold
  one); now the test makes the tenant's default itself when none exists, then proves the second is
  refused. *Chat* pressed `chat-archived-toggle`, which renders only when something in reach is
  archived; now `beforeAll` releases an untyped Creative job and archives it as the AM
  (`deliverable-archive-*`, the door section H proves), and the toggle is proven to show and hide
  that thread. Rule for the next spec: the "may not" half must set up its own premise — a long-lived
  database is not a fixture (traps.md).

### I51 — Fixes from the live site (16 Sep, Edward)

Four things seen on production and two the first of them uncovered. The audit finding is the big
one: *"all actions on the site are required to be auditable with created by, modified by etc. with a
brief note of what happened and where it happened… WHY IS THE CREATED BY ETC MISSING IN THE FIRST
PLACE."* Answer, from the schema: ADR-0008 put *who did what* in one audit log written by trigger,
not on the row; the log half was built and is enforced (`092`), the SHOW-IT half never was — 14 of
~60 tenant tables carry `created_by`, no work table does, the log is admin/lead-only, and the audit
screen names only people/roles/resources/offices/departments/teams (everything else is an 8-char id).

**All six built 16 Sep on `fix-cosmetic-16sep`** — migration `20260916120000` + pgTAP `123` (20 assertions;
whole suite 124 files / 1561 green on the throwaway Postgres), unit 2245 green, `tsc -b` exit 0, lint 0 errors,
coverage gate 0 new; browser: `deliverables-page` + `review-and-my-work` (32), `g-full-campaign` G4 with the
lock/re-open passage, `admin-catalogues-feedback-shell` + `campaign-wizard` (34), `p-capture-and-add-task` —
all green on the Docker stack after `db reset`. Two things learned the hard way, for traps.md: (1) actor
columns carry NO foreign key to `user_profiles` — the first cut added one from every table and every unnamed
`user_profiles(...)` embed in the app became ambiguous (the single-job release lost its deliverable's owner);
(2) cached `e2e/.auth` sessions outlive a `db reset` and every page then says "Couldn't load your
permissions" — delete the folder after a reset. ADR-0070 addendum written. Needs Edward: `db push`, then
`gen types`.

- [x] `I51.1` **Created by / modified by on every tenant table, as a standard — enforced, not
  remembered.** Migration `20260916120000`: `created_by` and `updated_by` (→ `user_profiles`, set null)
  added to every table carrying `tenant_id` that lacks them (the four log/content exemptions of
  `AGENTS.md` excepted); one trigger `app.set_actor_columns` (before insert: `created_by :=
  coalesce(created_by, auth.uid())`; before update: `updated_by := auth.uid()` when known) attached to
  each; back-fill from `audit_events` (first `insert` actor → `created_by`, last actor → `updated_by`)
  for every table with an `id`. pgTAP `123` asserts EVERY tenant table has both columns and the
  trigger, the way `092` asserts the audit trigger — a new table without them fails the build.
  `campaign_list_rows` gains `created_by_name`, `updated_by_name`, `created_at`, `updated_at`
  (appended — the view is re-stated verbatim, traps.md). The drafts table on `/campaigns` shows
  *Started by · on* and *Last edited by · on* beside the account manager; the campaign and
  deliverable headers say the same. `gen types` after push.
- [x] `I51.2` **The audit log names the record and where it sits.** `resolveEntityName` resolves
  campaigns, campaign_briefs (campaign · department), deliverables (campaign · name), sub_tasks
  (deliverable · title), jobs, clients, brands, streams; a *Where* column carries the campaign or job
  the row belongs to. No schema change. Was: *"Department brief · 04e20210"*.
- [x] `I51.3` **An approved department brief is locked; the approver re-opens it to change it.**
  Reverses ADR-0070 d.8 (*"editing an approved brief is allowed and does not revoke the approval"*) —
  Edward, 16 Sep, on finding a lead outside the department had edited an approved brief: option A.
  ADR-0070 addendum. `campaign_briefs_manage_update` gains the scope test it never had
  (`app.in_write_scope(department_id, null, campaign AM)`) and `approved_at is null`;
  `reopen_department_brief(p_brief)` — same authority as `approve_department_brief`, clears
  `approved_at`/`approved_by`, audited as `department_brief_reopened`; the assignment gate
  (`sub_task_brief_is_approved`) then holds new assignments until re-approval, as ADR-0070 d.4 says.
  UI: Edit hidden on an approved brief; **Re-open** for the approver, confirmed, worded. pgTAP in `123`.
- [x] `I51.4` **The up/down arrows on a task row sit off the row.** `.row-reorder` is `display: flex`
  on a `td` — the same trap `.row-actions` hit on 8 Sep (a flex cell leaves table layout). Table-cell
  again, spacing on the children.
- [x] `I51.5` **Add sub-task is a button and a modal.** The eight-field inline form under the task
  table (`DeliverablesPage.tsx:1535`) becomes an **Add sub-task** button opening `AddSubTaskDialog`;
  the task name is the only required field; assignee, reviewers, SLA profile, hours, due date and
  review mode optional. Kept: naming an assignee asks for a reviewer (ADR-0089 d.3). Three specs
  updated (`deliverables-page`, `review-and-my-work`, `p-capture-and-add-task`).
- [x] `I51.6` **The required-input picker does not refresh when a task is added, removed or
  cancelled.** Its candidates live under `requirements/candidates`; the three task mutations
  invalidate `deliverables` only. They now invalidate `requirements` too.
- [x] `I51.7` **A notification is a door to the thing itself — built 16 Sep.** Edward, on an extension
  request that "led to the blank schedule": the link went to `/my-work`, the AM was refused there and
  bounced to their default page. Now `extension_requested` and `resource_clash` (read by an approver or
  a lead, not the assignee) open `/deliverables?task=<id>` — the page looks up the task's deliverable,
  opens it and marks the row (`is-focused`). The answers (`extension_approved/refused`) stay on the
  assignee's My Work, which carries their task. Every other type's door checked and left as is (the
  reasons are in `href()`). Unit test on the inbox; browser: `i-scheduling` I4 walks the bell.
- [x] `I51.8` **The account manager can open My Work — built 16 Sep.** Migration `20260916130000`:
  the role never held `my_tasks:view` (not in its 12 Aug list nor any re-statement since); the seeder
  is restated with the one grant and existing tenants back-filled. Edward: *"AM still must see my-work
  as they have reviews etc. as well."*
- [ ] `I51.9` **"Waiting on you" on My Work — PARKED with the dashboard / My Work redesign (`I48.16`).**
  Edward, 16 Sep: option C — the minimal fix now, the panel with the redesign. Proposed rows, for the
  redesign to take or leave: campaigns awaiting your approval; unfinished briefs you started;
  department briefs you can approve; task lists you own awaiting approval; deadline extensions awaiting
  your answer; booking requests awaiting your answer. Each a direct link. *"There is no point offering
  the ability to approve an extension if the user has to manually search various pages."*
- [x] `I51.10` **`e2e/local/notifications.spec.ts` failed on `main` — a stale spec, not a product bug.
  Fixed 16 Sep.** The first symptom read as "the Motion lead's notification is marked read a second
  after it is written" — that was the spec's own click on the item; and a run that dies mid-way leaves
  the deliverable with the Motion lead, so every later run reassigns nothing, finds the OLD (read) row
  and fails on the badge. The real stall was at the hand-back: since 15 Sep every write on the
  deliverables page answers with a "Done" dialog in front of it (ADR-0092 d.2), and this spec — older
  than that — never closed it, so its second click waited out the test. A temporary trigger logging
  who writes `read_at` (jwt sub + query) proved the writer was the recipient's own PATCH. Spec closes
  the dialog after each save; green twice.

### I52 — The notification emails, read as sent (17 Sep, Edward: "the content users are receiving seem random")

The copy draft (`docs/reference/notification-email-copy.md`) could not be reviewed: *"it is full of
undefined labels… how do I know what you plan to insert into the fields."* So the product was run
on the local stack, one real mail per type re-sent through `notify-email` into Mailpit, and every one
captured with its notification row: **`docs/reference/notification-emails-as-sent.md`** (20 mails,
17 types, EN + AR, campaign and ad-hoc shapes; images under `images/notification-emails/`). The
wording decisions stay Edward's, in the copy draft; the rows below are what the samples showed
regardless of wording.

- [x] `I52.1` **The name is doubled on every task in a single job: `job — step — job`.** **Fixed 17 Sep:**
  `deliverableNameFor` (`lib/single-job.ts`) names the single job's deliverable from "What is
  needed" — the type, `×qty` when more than one — with the job title only as the fallback for an
  untyped job; unit-tested; sections B/C/D/P green. New jobs only. Two
  decisions meet: a task's title is composed as *step — deliverable* at creation (ADR-0071 d.10) and
  the email prefixes the campaign (I30.7); a single job's deliverable is named after the job
  (`SingleJobWizard.tsx:262`), so the job name appears twice. Deliverable-level mails on a single
  job read `job — job` (review_requested, chat_added, feedback_collected, deliverable_reassigned).
  On a campaign with distinct deliverable names it reads `campaign — step — deliverable`. Options,
  for Edward: (A) drop the prefix when the campaign name already appears in the work's name;
  (B) stop composing the deliverable into the task title and let the prefix carry it (touches every
  title the pilot has issued — ADR-0052 d.14 says titles are copied, never re-derived); (C) leave.
  **Edward, 17 Sep, on seeing it: "why is the deliverable name the same as the campaign title?"** —
  a defect: SJ-02 asks **"What is needed"** — the deliverable dropdown, with quantity, channel and
  format — and the wizard saves the choice as the deliverable's *type* but names the row from the
  **Job title** box (`SingleJobWizard.tsx:262`). The descriptive name the AM chose is ignored. Fix:
  name the deliverable from what was picked (type, + ×qty when more than one) — one line, no new
  field, no ADR. New jobs only; existing titles stay (ADR-0052 d.14). Held with the rest of I52
  until Edward has been through every message.
- [x] `I52.8` **The fifteen actions, built (17 Sep).** Edward decided each mail one at a time —
  recipient, then the exact words, with real names and dates (`docs/reference/notification-email-copy.md`,
  *Decided one action at a time*). Migration `20260917110000`: `notifications.detail` (the facts
  the emitter knew — moved-from days, the approved prerequisite, who a task went to); approval
  tells the deliverable OWNERS only, one row per deliverable, on the deliverable; an owner change
  tells the new owner (`deliverable_reassigned`) and the old (`deliverable_owner_removed`, new); a
  reassignment tells the person it was taken from (`task_reassigned_away`, new); submitting names
  the TASK and asks a required reviewer to review (`review_requested`) and an optional one for
  feedback (`feedback_requested`, new) — as does "everyone has answered"; "you can start" names
  what was approved and goes to the deliverable's owner when nobody is assigned; a moved booking
  carries from/to; a required person's booking its days and the assignee; an attached request
  tells its new owner first. `blocked` and `brief_awaiting_approval` removed. `notify-email`
  rewritten around a fact-gathering step (extension dates + reason from `sla_events`, booking
  requests' person/days/hours, reviewer counts) and the decided words EN/AR; the inbox lines and
  doors follow; My Work honours `?task=` (I52.4, the assignee's mails open the task). Proof: pgTAP
  125 (+076/097/104/106 re-pointed), `coverage/notification-mails.spec.ts` (Actions 1–7 end to
  end through Mailpit, asserting who is and is not told), section J and notifications.spec
  re-pointed. As-sent document regenerated (third pass, 22 mails). **Deploy: `db push` +
  `functions deploy notify-email` — Edward.**
- [x] `I52.2` **The facts line does not say what the date is** — superseded: the decided sentences
  carry the date in words ("It is due Thursday 24 September 2026 and estimated at 4 hours"); the
  grey line stays only where the sentence does not already say it.
- [x] `I52.3` **A single job is called a campaign** — gone with Action 1's sentence: *"<name>
  approved <title>."*
- [x] `I52.4` **Task mails land on My Work, not on the task.** Every task event's button opens
  `/my-work`; deliverable events deep-link to the row (`?campaign=…&open=…`). `I51.7` built the
  task-in-deliverable link for extension requests — **in the inbox only; the EMAIL button still went
  to My Work. Fixed 17 Sep for `extension_requested` and `task_reinstated`** (readers who hold
  `project_tasks:manage`). The assignee's own events (assigned, changes_requested, signed_off,
  cancelled, rescheduled, extension_approved) still land on My Work: `/deliverables` needs a grant
  a team member may not hold — a decision, not a one-liner. **17 Sep: every assignee mail now
  opens the task on My Work (`/my-work?task=<id>`, the row marked) — the door a team member holds.**
- [ ] `I52.5` **Types raised by no browser test** (17 Sep: `dependency_ready`, `feedback_collected`,
  `resource_required`, `resource_clash`, `assignment_superseded`, `extension_refused` had no sample
  in the third-pass run; their rows are proven in pgTAP 125 and their words sit in the same map): `blocked`, `dependency_ready`,
  `resource_required`, `resource_clash`, `brief_awaiting_approval`, `assignment_superseded`,
  `extension_refused`. No sample exists and their wording cannot be reviewed as sent. A gap of the
  ADR-0095 kind — each needs a flow that raises it, asserted through Mailpit.
- [x] `I52.6` **The specs clear Mailpit mid-run, so a full run leaves 13 of 123 mails.** Not a
  product fault: `clearMailbox()` is called per step. The samples were produced by re-posting
  `{ id }` for one row per type to `notify-email` with the Vault bearer — the same call the trigger
  makes — into an untouched mailbox. The way to reproduce is in the document's header.
- [ ] `I52.7` **`task_reinstated` says "unassigned until somebody picks it up" — nobody can.** Edward,
  17 Sep. The mail goes to the person who was the assignee when the task was cancelled
  (`sub_task_reinstate`, ADR-0068 d.6); reinstate clears the assignee and does not rebuild the
  bookings (d.5), and there is no self-assignment anywhere (ADR-0040) — a lead has to assign it
  again. **Edward, 17 Sep: "this is idiotic… the reinstatement requires action" — the mail goes to the
  one person who cannot act.** Decided, option A: **Reinstate asks "assign to whom?" in the same
  step** — the assignee picker opens, the task comes back assigned and booked through the normal
  path, the assignee gets the ordinary `assigned` mail, and no `task_reinstated` mail is sent; if the
  picker is dismissed the task comes back unassigned and the leads in reach (the ADR-0087 answerer
  set) plus the deliverable's owner are told it needs assigning — never the former assignee. Amends
  ADR-0068 d.5/d.6 — **the addendum waits until Edward has been through every message.** **Built 17 Sep
  (Edward: "fix what we have so far"):** migration `20260917100000` — `sub_task_reinstate(p_sub_task,
  p_assigning default false)` tells the leads in reach (the ADR-0087 d.6 shape over the task) and
  the deliverable's owner when it comes back unassigned, nobody when the caller is assigning it;
  pgTAP 124. `ReinstateDialog` on both Reinstate doors: assignee + the task's own reviewers,
  *Reinstate and assign* (reinstate, then `save_sub_task` + `subtask-schedule` — the ordinary
  `assigned` mail) or *Reinstate unassigned*. Subject now *Needs assigning: …*. **Edward, on the
  first re-run: the button opened the task on the Deliverables page, where nobody can assign — the
  page edits title, date and review mode only; an unassigned task is assigned on the Schedule
  (`+` on a person's day → campaign → deliverable → task). Option A chosen: the mail and the inbox
  row open the Schedule on the task's due week (`/schedule?on=`), and the sentence says "on the
  Schedule".** Coverage spec asserts both mails through Mailpit. The ADR-0068 addendum is still held.
- [x] `I52.9` **The campaign page's rings never refreshed on their own** (Edward, 17 Sep, on
  production). `useCampaignDeliverables` was cached 30 s with no refetch on focus, no interval, no
  subscription — a campaign page open in a second tab kept the old task count after a task was
  added elsewhere, indefinitely (reproduced). **Fixed:** refetch on focus + a 20 s interval while the
  page is open; the rings spec proves a second tab catches up by itself.
- [x] `I52.10` **What the two rings measure — decided and built (Edward, 17 Sep).** *Deliverables:*
  one ring PER DELIVERABLE, "Social Advertisement — 0 of 5 complete", its tasks done of its tasks,
  filling as tasks are approved (`deliverableProgress`; archived deliverables show no ring).
  *Tasks assigned:* assigned of ALL tasks — a done task stays in the total and counts as assigned;
  only a cancelled or removed task leaves it ("done is a status, not whether or not it counts").
  `countTasks` now returns `taskTotal`/`doneCount` beside the live pair the archive wording and
  the sign-off warning still read; `taskCoverage` counts on the total; the compact line per
  department reads "n of m tasks complete". Before: the first ring counted CLOSED containers
  (all-or-nothing) and the second excluded finished work, so it shrank as work was done. Amends the
  31 Aug reading of the strip; unit + `coverage/campaign-rings.spec.ts`.
- [x] `I52.11` **Task-level status badges on the campaign page** (Edward, 17 Sep). The task row's
  badge carried no status class, so every task read as neutral grey whatever its state. Now
  `state-badge state-<status>` — **Not started** (was "To do") in ORANGE (Edward), In progress blue,
  In review amber, Done green, Cancelled red — on `DeliverableDetail`, i.e. the campaign page's
  *Open tasks* and the Deliverables page alike; it follows *Start* at once. Note for the design
  pass: Not started and In review both draw on the warn token (the .pen has one orange). Proven in
  `coverage/campaign-rings.spec.ts`.
- [x] `I52.12` **The review under a deliverable's task list belonged to no task** (Edward, 17 Sep:
  *"the deliverable is never submitted for review"*). `DeliverableDetail` ended with
  `<ReviewPanel deliverableId isReadOnly />` — every version of every task, newest first, no task
  named — so with several tasks nobody could tell whose v1 they were reading. Option C: **Open
  review** in each task's action column (`subtask-review-open-*`) opens THAT task's review in a
  dialog — its versions (digital) or the maker's account (manual), the reviewer's actions when it is
  their turn — and the deliverable-level panel is gone. Upload stays the maker's on My Work
  (`ReviewPanel allowUpload={false}`, ADR-0058 d.1). Proven in `campaign-rings.spec.ts` and
  `review-and-my-work.spec.ts` (re-pointed).
- [x] `I52.13` **A deliverable can be renamed on its campaign or job** (Edward, 17 Sep). Nothing
  offered it, and since `I52.1` most are called after their type. Migration `20260917120000`:
  `app.tg_deliverable_name_guard` (before update of `name` — its owner, the campaign's account
  manager, or `project_tasks:manage` in reach of its department; a blank name refused; a PATCH
  governed identically, ADR-0037) + `public.rename_deliverable` (invoker). On the campaign page's
  department tab: an edit icon beside the name → inline input, save/cancel, Enter/Escape; the
  ring's label follows. **Task titles composed from the old name did NOT follow** (ADR-0071 d.10 —
  titles are copied at creation). **Reversed 20 Sep: they follow — ADR-0071 addendum d.10a, `I53.7`.** pgTAP 126; `campaign-rings.spec.ts`
  (may / may not, a Content lead refused in words). **On production (`db push` 17 Sep, confirmed 20 Sep).**
- [x] `I52.14` **"Committed: 17 Sept 2026, 13:00" on My Work — a booking's end printed as a promise**
  (Edward, 17 Sep). The line is ADR-0088 d.1 (plan vs commitment, shown when the DAYS differ), but
  the commitment is stamped from `due_at` at first assignment, and `app.sync_subtask_span` sets
  `due_at` to the END OF THE LAST BOOKING (ADR-0039) — 13:00 after four hours from 09:00 — so a task
  assigned without an explicit due date commits to a shift end, and the first drag to another day
  makes the line appear. Two faults: the stamp takes a booking end, not a deadline day (ADR-0076,
  18:00 Iraq); the display prints a clock time (`formatIraqDateTime`) where deadlines print a day.
  Proposed: stamp at the close of the due day and only for a SET due date; show a day; backfill.
  Touches ADR-0075/0088's mechanism — Edward to say.
  **Built 20 Sep (ADR-0075 addendum d.3a–d.3c):** migration `20260920110000` — the stamp is
  `app.commitment_instant(due_at)`, the plan's last DAY at 18:00 Asia/Baghdad (`app.close_of_day`),
  never the placed booking's end hour; My Work, the Deliverables page and the booking dialog print
  the committed DAY (`formatIraqDate`). pgTAP 131. **Not done, on purpose (d.3c): the correction of
  EXISTING stamps on production** — a follow-up migration moving each `committed_due_at` to 18:00 of
  the same day, to be proposed with its row count for Edward to approve before `db push`.
  **Written 22 Sep (branch `fix/retest-stamps-adr-0095`):** migration `20260922100000` — one
  UPDATE moving every `committed_due_at` that is not already the close of its Iraq day to 18:00
  of that day (the day never changes); `committed_starts_at` and `committed_hours` untouched; no
  `sla_events` row (neither a stamp nor a move of the day); the audit trigger logs each row; the
  count is raised as a NOTICE on push. pgTAP 139. **The production row count is Edward's to read
  before the push** (the migration's own `where`, as a `count(*)`, in the SQL editor).
- [x] `I52.15` **"Users are not pressing Start and somehow submitting for review — or the task list is
  not updating: which is it?"** (Edward, 17 Sep). **The list.** The only submit door (My Work) sends
  no manual minutes, so an unstarted task has no timer and `app.sub_task_submit` refuses it; every
  task in review was started. What the lead saw was `I52.9`'s class on the other reads: the
  Deliverables page's task list (`useDeliverable`), My Work, Awaiting review and the ad-hoc list were
  cached 30 s with no refetch on focus and no clock. **Fixed:** all four re-read on focus and every
  20 s. **And the loophole closed:** the function accepted `todo` when manual minutes were supplied,
  so a direct call could put an unstarted task in review; migration `20260917130000` — submit only
  from `in_progress`, worded *"start the task before submitting it for review"*. Suite 026's
  "submit-without-start with manual minutes is accepted" reversed; 028/030/045/073/115/125 start
  their tasks first. **On production (`db push` 17 Sep, confirmed 20 Sep).**
- [x] `I52.16` **A campaign named the wrong account manager and nobody could approve it** (Edward,
  17 Sep, production: the client's manager, Mais, created it; the row named the Account Director;
  she could not approve, and neither could a Power Admin). The screen offered *Approve* to the ONE
  resolved name (`approverId === session.user.id`) though `app.approve_campaign` admits anyone with
  `projects:manage` whose reach covers the manager — tenant-wide and all-accounts (ADR-0083 addendum
  d.14). **Fixed:** the page offers Approve to everyone the database admits and lets it word the
  refusal for anyone else. How the AD got onto the row is not established (the wizard writes what
  its box held; the box is prefilled from the client's manager at that moment) — the Audit page for
  that campaign shows the insert and by whom.
- [x] `I52.17` **A campaign's account manager can be changed on its page.** Nothing touched the field
  after the wizard wrote it, so a wrong name was permanent. Migration `20260917140000`:
  `app.tg_campaign_account_manager_guard` (before update of the column — the current manager, or
  `projects:manage` with reach over them; the named person must hold `account_manager:manage`; a
  PATCH governed identically, ADR-0037) + `public.set_campaign_account_manager` (invoker). On the
  page: an edit icon beside the manager's name → a picker of eligible managers, or "the client's".
  pgTAP 127; `campaign-approval.spec.ts` — the production shape made directly (row names the AD):
  the AM refused, a lead offered nothing, the Power Admin offered Approve and corrects the manager,
  she approves. **On production (`db push` 17 Sep, confirmed 20 Sep).**
- [x] `I52.18` **Generate brief failed "with no reason or report".** `functions.invoke` reports every
  non-2xx as one opaque error with the function's own `{ code, message }` left on `.context`; the
  ingest path unpacked it (ADR-0072), the department-brief writer never did — so a missing model
  key (503 `model_unconfigured`), a timeout and a refusal all read "The brief could not be written",
  unreportable. **Fixed:** `describeBriefFailure` reads the code and message back; refusals are
  worded (before approval / not yours / not found); `model_unconfigured`, `model_unavailable` /
  `model_truncated` and `too_long` have their own sentences; anything else is the generic line with
  the function's words and Report carrying the cause. `campaign-wizard.spec` proves the 503 case.
  **Why there was no task list:** tasks materialise from a deliverable's TYPE (ADR-0052); an untyped
  deliverable gets none — and the brief is not what generates tasks. Not investigated on production;
  the deliverables' types on that campaign are the thing to check.
- [x] `I52.19` **A client's account-manager change reaches its open campaigns** (Edward, 17 Sep: *"it
  needs to propagate automatically — this was working yesterday"*). It was, by accident: until
  ADR-0073 d.5 made the wizard's AM field required, campaigns carried NO manager and the fallback to
  the client's applied to all of them; once every row carries its own value the fallback never
  fires. Migration `20260917160000`: `app.tg_client_account_manager_propagates` — a change of
  `clients.account_manager_id` moves every campaign of that client that is not closed and named the
  OLD manager (or nobody) onto the new one; a campaign given a different manager on purpose keeps
  them; closed ones keep their record. pgTAP 129; `campaign-approval.spec` (Traffic changes the
  client on the Clients screen → the campaign follows → the new manager approves). **On production (`db push` 17 Sep, confirmed 20 Sep).**
- [x] `I52.20` **Add a deliverable to an existing campaign or job** (Edward, 17 Sep) — the general
  form of `I48.43`. Migration `20260917150000`: `public.add_campaign_deliverable` (definer; the
  approval authority — the account manager, or `projects:manage` with reach over them) inserts under
  the campaign's stream (or makes one, as the wizard does) with owner, type, quantity, due; the owner
  stamps the department (ADR-0050), the type materialises the task list (ADR-0052), a warned-about
  due date is recorded (ADR-0093). On the campaign page: *Add deliverable* above each department's
  table (`DeliverableDialog`, with the wizard's due-date warning). A lead is offered nothing.
- [x] `I52.21` **Edit a deliverable — name, type, quantity** (Edward, 17 Sep: *"no type was set on
  the deliverables"*, so no task list ever materialised and nothing could set one). Same migration:
  `app.tg_deliverable_edit_guard` replaces the name guard (name, type, quantity under one rule — its
  owner, the account manager, leads in reach; blank name refused; a type CHANGE while tasks are live
  refused in words, since a second list would land on the first, ADR-0052 d.6) +
  `public.update_campaign_deliverable`. The row's edit icon opens the dialog; an untyped row is
  marked *no type — no task list*; **setting a type on an untyped deliverable materialises its tasks
  then** — the production fix. The due date stays with *Change promise* (ADR-0088 d.7a). pgTAP 128;
  `campaign-rings.spec.ts` (edit may / may not / failure; add untyped → typed → tasks appear; a
  typed add; a lead cannot add). **On production (`db push` 17 Sep, confirmed 20 Sep).**

### I53 — The campaign side brought level with the single job (20 Sep, Edward)

Edward's list for the day, after the 17 Sep walk-through: the full-campaign intake still looks and
behaves as it did before the single-job redesign (ADR-0082–0090), and a job promoted to a campaign
cannot grow. Branch `fixes-20-sep`. Each row is presented with options before it is built; the
⚠️ rows need an ADR first.

- [x] `I53.1` **The campaign brief wizard is built from the single job's parts** (20 Sep; the first
  cut did the frame only and said more than it had — Edward: *"this is clearly not true"*). Now:
  the `sj-head` title, subtitle and *Step n of 6* chip; the `StepRail`; the steps as the single
  job's two-column `Panel`s of `Field`s — step 1 *The campaign* (name, client + brand, account
  manager with its rule as the hint, the receipt) beside *Brand documents*; step 2 *The brief*
  (read it in, then the strategy fields, required and machine-filled marks in the Field shape)
  beside *Performance details* and *Campaign reference materials*; steps 3–5 one panel each with
  the guidance as hint lines rather than amber boxes; the `sj-foot` footer in the single job's
  order. `DocumentFiling` draws no heading inside a panel. Unit 73/73; the wizard and phases
  coverage specs 33/33; gate clean. **Edward inspects on the local stack.**
- [x] `I53.2` **The model proposes deliverables from the catalogue only — ADR-0097, accepted and
  built 20 Sep.** `generate-deliverables` is one call: the catalogue is the prompt's menu grouped by
  category, `type_code` a free string checked afterwards (never an enum in the schema — the 29 Aug
  lesson), the row named by its catalogue entry with the brief's words as a `note`; a code outside
  the catalogue comes back `needsType` and the wizard refuses Next until a person chooses; the
  response says how many; with phases given the model suggests `phase_number` (ADR-0096 d.8).
  `src/lib/brief/deliverables.ts` rewritten (the `classify*` pass gone), 66 unit tests across the
  library, the handler and the client hook; `campaign-phases.spec.ts` drives it through the wizard.
- [x] `I53.3` **Every field that picks one of the 260 is a searchable picker labelled "Deliverable"**
  (20 Sep; Edward: *"if we pick a deliverable a type is already mapped"*). `DeliverablePicker`
  (`src/components/`) — typed search on name, code or category, grouped by category so the twelve
  shared names read apart, keyboard-navigable, the chosen entry's code and category as a chip;
  opens on click or a keystroke, not on focus (a dialog's first-control focus dropped 260 rows over
  Save). In the wizard's rows (the Category and Type selects are gone; the row's name is a *Label*
  beside it), *Add / edit deliverable*, *Propose more deliverables*, and the single-job request
  (`sj-type`, which had a name-only search). 7 unit tests; pressed in three coverage specs.
- [x] `I53.4` **A promoted job grows: its brief is edited on the campaign page and more deliverables
  proposed from it; existing ones untouched** (20 Sep — the remainder of `I48.43`). Migration
  `20260920140000`: `app.tg_campaign_brief_guard` (a released campaign's brief is the approval
  authority's; a draft's is the wizard's; `audience`/`insight`/`proposition` follow the document on
  every write; a closed campaign refuses) + `public.update_campaign_brief` (worded 42501 for a caller
  RLS would have hidden the row from). On the page: *Edit this brief* (one textarea per field,
  Save/Cancel) and *Propose more deliverables* (`GenerateDeliverablesDialog`: the model is told what
  the campaign already has, duplicates are dropped, every row needs owner and date and — with phases
  — a phase, then `add_campaign_deliverable` row by row). pgTAP 132; `campaign-phases.spec.ts`
  promotes a job, edits, proposes, adds, and proves the original row untouched.
- [x] `I53.5` **Campaigns contain phases — ADR-0096, accepted and built 20 Sep.** Migration
  `20260920100000` (additive only, d.13): `campaigns.has_phases`, `campaign_phases` (number, name,
  start, end; overlap allowed; RLS read, writes by RPC; the table grant the migrations never made),
  `deliverables.phase_id` held both ways by `app.tg_deliverable_phase_guard`, `set_campaign_phases` /
  `save_campaign_phase` / `delete_campaign_phase` / `move_deliverable_to_phase` under the campaign's
  approval authority (`app.is_campaign_authority`), `record_due_date_override` with a `phase_end`
  boundary, the wizard writer with `p_phases`. pgTAP 130 (35 tests: on/off, add, overlap, backwards,
  rename, move by RPC and by PATCH, the invariant, delete + renumber, off refused then allowed, a
  lead and a team member refused). Wizard: a *Phases* step (3 of 6) before the deliverables, a
  *Phase* column on the rows with the model's suggestion, the due-date fallback on Timing, the phase
  in the review tables, the after-phase-end warning. Campaign page: `PhaseStrip` (one ring per
  phase, dates, overdue), the filter, a *Phase* column with a move select for the authority,
  `PhasesDialog` (rename, re-date, add, delete, turn off), *Add deliverable* takes the phase.
  Pipeline and the schedule's Project view filter by phase (`pipeline-phase`, `filter-phase`, in the
  URL); the email facts line names the phase (d.11, read at send time). `campaign-phases.spec.ts`
  (26 tests) walks all of it as one who may and one who may not, including the RPC door as a lead
  and a team member. **Edward to inspect the layout on the local stack (d.9).**
- [x] `I53.6` **A deliverable cannot be created without a due date** (Edward, 20 Sep). The wizard
  and `add_campaign_deliverable` (`p_due_at default null`) both accept none. With `I52.14`: a
  booking is entered as a DAY and HOURS — the 09:00 start and the end hour are the system's own
  placement (`src/lib/bookings/day-span.ts`, `DAY_START_HOUR`), never chosen by anyone — so a task's
  deadline is the day of its last booking at **18:00 Iraq** (close of business), and a booking's
  clock times are never shown or stamped as a commitment; the deliverable's due date is a separate
  thing. **Decided and built 20 Sep** — ADR-0093 addendum d.7–d.8: migration `20260920120000`,
  `app.tg_deliverable_due_date_guard` (a campaign deliverable is never inserted without `due_at`; a
  date once given cannot be cleared; old dateless rows left alone; ad-hoc work not covered) and
  `add_campaign_deliverable` refusing in words; the dialogs say it before the database does. pgTAP
  131; seven older suites' fixtures given dates. The 18:00 half is `I52.14`.
- [x] `I53.7` **A deliverable's rename reaches its tasks' titles** (Edward, 20 Sep; ADR-0071 addendum
  d.10a). Migration `20260920130000`: `app.tg_deliverable_rename_cascade`, an after-update trigger
  that replaces the ` — <old name>[ <unit>]` segment of every task title still carrying it, whichever
  door renamed; a hand-edited title is left alone. pgTAP 126 reversed and extended; the coverage spec
  renames on the page and reads the titles back.
- [x] `I53.9` **Guides 12 and 13, shot from a real walk** (Edward, 20 Sep: *"a detailed instruction
  manual with screenshots for setting up a campaign with 4 phases… another step by step manual how to
  view and manage campaigns… the list is too large with no real world style names"*).
  `e2e/local/guides/campaign-phases-guide.spec.ts` (`GUIDE_SHOTS=1`, skipped otherwise) creates
  **LUMA Season 2** for Luma Retail with four phases from the team's own sheet, then walks the page:
  31 screenshots into `docs/guides/images/12-*` and `13-*`; `docs/guides/12-campaign-with-phases.md`,
  `13-viewing-and-managing-campaigns.md`; Word copies in `<USER_GUIDES_DIR>`. The
  local database was `db reset` first (334 test campaigns gone; the `cov_*` single-field brief
  templates with them) and the seed's pending campaign given a due date so the reset runs under the
  new guard. **Three defects the walk found, fixed:** the campaign page printed a deliverable's due
  date as a clock time on the department tab and as a raw ISO string on *All deliverables* (now a
  day, both); the add/edit dialog's words still said *type* (now *deliverable*, ADR-0097 d.7); the
  phase strip's dates were ISO (now "21 Sept – 27 Sept 2026").
- [x] `I53.10` **The Pipeline draws a phased campaign as the sheet does — phases down, departments
  across** (Edward, 20 Sep: *"the pipeline view does not actually display phases"*; the first cut
  was a filter over the stage board). `buildPhaseGrid` (`lib/pipeline-board.ts`): every phase a row
  in number order (empty rows kept), the departments with work as columns, each cell that
  department's pieces in that phase as cards with quantity, status badge and due DAY; the row head
  carries the dates and "n of m signed off", late in the warn colour; the phase filter narrows to one
  row. Two older faults fixed on the way: the stage board grouped lanes by STREAM (one per campaign,
  so a three-department campaign showed one lane named after the first row's department — now by
  department, unowned last) and card dates printed a clock time. Unit tests for the grid and the
  lanes; `campaign-phases.spec` presses it; guide 13 re-shot.
- [x] `I53.11` **Every status badge is where the WORK is, never the container's "Draft"** (Edward,
  20 Sep: *"the status on all is currently draft… which does not actually match the webapp… why are
  we not using the established status badges"*). The Deliverables page has worn `progress.phase`
  (I40.22: Not started · In progress · In review · Awaiting sign-off · Complete · Delivered) since
  8 Sep; the campaign page's two tables and the new Pipeline grid still printed the container's own
  `state`, which reads "Draft" from the moment the row exists. All three now wear the work phase, and
  the unphased Pipeline board's COLUMNS are the work phases too (`blocked` / `cancelled` appended only
  when present). Also found by the same walk: the catalogue picker re-resolved a chosen entry BY NAME
  on a mere blur, and twelve names are shared across categories — editing a *Social Advertisement*
  (ADV-003) swapped it for SOC-009 and the database refused the type change; untouched, it now
  changes nothing. **Vocabulary, for the record:** the database's `streams` table is one CONTAINER
  row per campaign since ADR-0050 (29 Aug), not a discipline — the word never reaches a screen
  (three unused strings aside) and nothing user-facing should use it; a deliverable's department
  comes from its owner.
- [x] `I53.12` **A department's work is offered for assignment only once its brief is approved —
  the schedule picker and the gate read one answer** (Edward, 20 Sep: *"you are making deliverables
  available for assignment on the schedule when the tasks have not been approved… check the ADRs,
  this has been addressed multiple times already"*). Found on LUMA Season 2 — approved, no department
  brief written: the `+` picker offered all nine deliverables. Two faults, both against accepted
  decisions. (1) `app.sub_task_brief_is_approved` still read ADR-0070 d.5's *"absence is not
  refusal"*, so a department that had never GENERATED its brief passed the gate; ADR-0072 d.6
  (5 Sep) had already settled the ordering — the department generates, reviews and approves, *only
  then* is its work assignable (Edward, 11 Sep, in ADR-0090: *"only once approved do they surface
  for selection"*). A missing brief is now unapproved, and there is no "no department" exemption —
  every deliverable has an owner, so the department is always stamped (Edward, 20 Sep: *"it is not
  possible for a deliverable not to be assigned an owner"*). (2) ADR-0090 d.3a — *a held task is not offered anywhere
  assignment starts* — was applied to single jobs only, in the client. `public.assignable_deliverables(campaign)`
  (invoker, RLS-bound) now answers it for every kind of job from `app.deliverable_work_acceptance_refusal`,
  the same function the trigger reads, and `useProjectTasks` calls it; the dialog carries no rule of
  its own. Migration `20260920150000`; pgTAP 133 (no brief → refused and absent; generated →
  still absent; approved → offered and assignable; a single job by its list; anon refused), 083
  reworded, and six older suites (059, 074, 075, 097, 098, 099) that inserted ownerless campaign
  deliverables and assigned them now call `test_accept_campaign_work()` (`helpers/seed.sql`) —
  the state the product would have put the campaign in; `campaign-phases.spec` walks it in the browser as Traffic and the Creative lead. Nothing
  assigned already is touched. **Production note:** any existing campaign whose department never
  wrote a brief will now refuse NEW assignments until it does — that is the rule, not a regression.
- [x] `I53.14` **The quantity is printed beside the deliverable's name** (Edward, 20 Sep: *"why is
  there no quantity stated on any of the deliverables in the LUMA2 campaign?"*). It was stored and
  its tasks multiplied by it (ADR-0071) — Carousel ×4, Static Post ×8 — but only the wizard's review
  step and the Pipeline card printed it. The campaign page's department tab and All-deliverables
  table and the Deliverables list now read "Carousel × 4" when the quantity is more than one, the
  Pipeline's shape.
- [x] `I53.15` **Every task says which project it belongs to** (Edward, 20 Sep: *"each task lacks
  the project name… imagine 12 projects all with Static Posts"*; option B chosen over baking the
  project into the title). The task table under a deliverable (campaign page and `/deliverables`)
  prints "· LUMA Season 2 · Creative" after every title; the *Awaiting my review* rows and the
  review modal — which showed only the deliverable's name — now say which task and which project.
  My Work, the schedule chips, requests, emails and the inbox already did. The title itself stays
  "step — deliverable n", so a renamed campaign is right everywhere at once.
- [x] `I53.16` **"Waiting for you" — every approval the signed-in person can give, on My Work**
  (Edward, 20 Sep: *"confirm all pending approvals are displayed in respective individuals my-work
  page… Team Leads and Department Leads still need a my-work page"*). They were not: department
  briefs and held task lists sat on the dashboard behind `health:view`, which no lead holds — the
  people who owed them had no list; booking requests lived in the inbox, extension requests on the
  dashboard, a pending campaign on the campaigns list. `public.my_pending_approvals()`
  (`20260920160000`, security invoker) lists what the person OWES — the approver the system names
  (the department's own people, the owner, the lead the request was sent to, the extension's
  approver, the campaign's AM), each row re-checked against the door's own predicate. **Not** what
  a failsafe could approve: the first cut listed the whole company's approvals to the Power Admin
  (Edward: *"even though I am neither the Account Manager or the deliverable owner"*); ADR-0070
  d.6 — *the failsafe is a capability, not a queue* — is the rule, and Traffic and Admin keep it on
  the campaign page and the dashboard. `WaitingForYouPanel` at
  the top of My Work: kind, title, project · department, since; each row goes where the approval is
  given, a booking request is answered in place with the inbox's own control. Task reviews stay in
  *Awaiting my review*. pgTAP 134 (each kind as one who may and one who may not, and the list and
  the door agreeing); unit test; `waiting-for-you.spec`. The dashboard's two `health:view` panels
  are untouched — they are the company-wide view, this is the personal one.
- [x] `I53.13` **Two retest-redesign specs are stale against the built product** (found in the 20 Sep
  full run; neither is caused by today's work). `k-my-work.spec` K2 presses `deliverable-start-<id>`
  on a released job's deliverable, which is no longer a draft by then (its state has already moved
  when K1 assigned its tasks); `n-single-concept.spec` N6 expects the discard control to READ
  "Discard concept", and it is an icon (`DeleteButton`, per the icons-over-text rule). Fix the
  specs to the product, not the reverse. Also from that run: `i-scheduling` I5 now expects the
  18:00 Iraq stamp (ADR-0075 d.3a), `g-full-campaign` G4 accepts any generated field (the real
  templates since the reset), and the seed gives Northwind a WRITTEN Content brief so H4 / L4 / N1
  hold on a clean database — those four are done in this change set.
  **Fixed 21 Sep (branch `fix/retest-stamps-adr-0095`):** K2 no longer presses Start — it asserts
  the container is already `in_progress` because the maker started a task in K1 (ADR-0077 d.7)
  and that no Start is offered; N6 reads the discard's accessible name ("Discard concept") and
  `data-armed` instead of its text; N8 chooses a template only when the choice is shown (a
  department with a default template goes straight to Generate). Also: `auth.setup.ts` puts every
  persona back to the seed's language before a run — since `I53.21` a person switched to Arabic by
  an earlier run (the inspection walk) opened every later page in Arabic and the English
  assertions failed for no reason a spec could see. Sections K and N green.
- [x] `I53.8` **End-to-end browser tests for every new feature, as one who may and one who may not**
  (Edward, 20 Sep: *"promote single to campaign, create campaign with phases, add phases to existing
  campaigns etc. … including testing unauthorised access"*; ADR-0095). Coverage specs under
  `e2e/local/coverage/`: a campaign created with phases (wizard step, proposals from the catalogue
  with suggested phases, a flagged row refusing release, due date required); phases turned on for an
  existing campaign (one phase holding everything, move, delete + renumber, turn off refused then
  allowed); a single job promoted, its brief edited, new deliverables generated with the existing
  ones untouched; the phase strip and filters (campaign page, schedule, Pipeline); the email naming
  the phase (Mailpit); the picker; the rename cascading; the 18:00 deadline line; and for each door
  a lead / a team member / a person outside reach refused in words. **Built 20 Sep:**
  `e2e/local/coverage/campaign-phases.spec.ts` — 26 tests, green on the local stack; the whole
  coverage suite 91 passed / 1 skipped; `check:e2e-coverage` gate clean (0 new uncovered controls).
  `campaign-wizard.spec.ts`, `campaign-rings.spec.ts` and two retest sections re-pointed for the
  Phases step, the picker and the required due date.

- [x] `I53.17` **`supabase db reset` failed on the committed seed** (found 21 Sep, the inspection walk):
  the 20 Sep edit that gives Northwind a written Content brief references `v_content` inside the
  second `do $seed$` block, which never declared it — `ERROR: column "v_content" does not exist`,
  and a fresh local database came up EMPTY (no tenant, no logins). The 20 Sep reset ran before that
  edit, so nothing had exercised it. Fixed 21 Sep: the declaration added to the block. Lesson: a
  seed edit is proved by a `db reset`, not by the running database.
- [x] `I53.18` **A deliverable added to a released campaign tells nobody** (found 21 Sep, the
  inspection walk). *+ Add deliverable* and *Propose more deliverables* both go through
  `public.add_campaign_deliverable`, which writes NO notification; only `attach_job_to_campaign`
  (Action 15, 17 Sep) tells a new owner. The Motion lead and the Design lead were given new work on
  the promoted campaign and neither had a mail or an inbox row; nothing appears on their My Work
  either until a department brief is owed. Needs Edward's words (the Action 15 sentence fits:
  `Added to <campaign>: <deliverable>` to the new owner; one line to the other owners) — then the
  insert in `add_campaign_deliverable`, the pgTAP row, and the Mailpit spec.
  **Built 21 Sep (Edward: "the assignee must be notified… email only for the owner of the added
  deliverables"):** `20260921100000` — `add_campaign_deliverable` writes one `deliverable_added`
  (for_owner) row to the NEW owner on a released campaign, nobody else; pgTAP 135; Action 16 in
  `notification-email-copy.md`; guide 13. **Later the same day (Edward: "drop the one-liner"):**
  `20260921140000` — `attach_job_to_campaign` no longer sends Action 15's one-line notice to the
  OTHER owners on the job either; pgTAP 106 re-pointed.
- [x] `I53.19` **Approving a campaign mails an owner once PER DELIVERABLE** (found 21 Sep). Action 1's
  emitter (`20260917110000`, `select … from deliverables d`) writes one `campaign_approved` row per
  deliverable, so an owner of three deliverables gets three "Approved: <campaign>" mails with the
  same words. Decide: one per owner (the body already says "review the brief and tasks"), or one
  per deliverable with the deliverable named. Nothing else changes.
  **Built 21 Sep (Edward: option a, "+ what action is required"):** `20260921110000` — one
  `campaign_approved` row per OWNER, on the campaign, `detail.deliverable_count` / `deliverables` /
  earliest `due_at`; `notify-email` says "Approved: <campaign> — you own N deliverables", names
  them, and what to do; pgTAP 136, 076/104 re-pointed; `notification-mails`, `campaign-phases`
  and retest D specs re-pointed. **Later the same day (Edward: "explain why phase is not included
  in the email.. this makes no sense to me" → "do it that way"):** `20260921150000` — each piece
  in `detail.deliverables` carries its due date and its phase, and the mail lists them one per
  line: "• Teaser — Phase 1: Pre-Launch, due Saturday 26 September 2026"; ADR-0096 d.11 kept.
- [x] `I53.20` **A promoted job's department brief is the single job's own six-field brief, approved
  at creation** (found 21 Sep). After *Promote*, the Creative tab shows the `single_execution`
  brief locked as Creative's department brief; there is no *Generate*; every Creative deliverable
  added afterwards (a Social Video, a TVC, a Key Visual × 3) is assignable on the strength of a
  brief that never described it, and nobody is asked to write a fuller one. The gate
  (`app.deliverable_work_acceptance_refusal`) is behaving as written; the question is whether a
  promotion should re-open the department brief (or clear its approval) so the lead writes the
  campaign-scale one. Also: `campaigns.brief.kind` stays `single_job` after promotion, and the
  promoted campaign's **Campaign brief tab reads "Nothing has been written here yet"** until the AM
  presses Edit — the job's own words and task (in `campaign_briefs`) are never shown there.
  **Built 21 Sep (Edward: option C):** `20260921120000` — `promote_single_job` puts the request's
  words into `background` and the job brief's task into `task` (the job brief kept whole under
  `promotedJobBrief`), then re-opens the department's row through `reopen_department_brief` and
  empties it: the tab offers Generate, the gate holds NEW assignments, made ones stand; audited as
  `department_brief_reset_on_promotion`. `update_campaign_brief` now MERGES (an edit had been
  dropping `request`, `phases`, `deliverables`). The page shows no approval control on an empty
  brief. pgTAP 138; guides 3 and 13.
- [x] `I53.22` **An UNWRITTEN department brief is owed by nobody on My Work** (found 21 Sep).
  `public.my_pending_approvals()` lists a `department_brief` row only where a `campaign_briefs` row
  exists and is unapproved ("delivered by the campaign's approval and not yet accepted"). After a
  campaign is approved, the department whose brief is not yet generated sees nothing on *Waiting
  for you* — only the "Approved: …" mail, whose words say "review the brief" as if one existed. The
  Content lead saw a row on the seed's Northwind (its brief is written); the Creative leads saw
  none on LUMA Season 2 (unwritten). Decide whether "write your department's brief" is an approval
  the panel should carry (ADR-0072 d.6 makes it the gate to any assignment), and if so its row
  opens the department tab's Generate.
  **Built 21 Sep (Edward: "'Waiting for you' gains a row: 'Write Creative's brief for LUMA Season
  2', which opens the department tab with the Generate button"):** `20260921130000` — a new kind
  `department_brief_unwritten` in `my_pending_approvals()` for the department's people who can
  write it (projects:manage) on an approved campaign with work for them and no written brief (an
  emptied row counts as unwritten); the written kind excludes an emptied row. The campaign page
  opens on `?tab=<department>`. pgTAP 137, 134 adjusted; `WaitingForYouPanel` words it as the
  thing to do. A department with NO lead (Production) has nobody to write its brief — the account
  manager does; noted, not changed.
- [x] `I53.21` **The chosen language is not remembered across page loads** (seen 21 Sep, the Arabic
  walk). `i18n.changeLanguage` is in memory only; every full load returns to English, and
  `user_profiles.locale` (the seed gives the animator `ar`) is applied nowhere. Not new — noted so
  it has an ID.

  **Built 21 Sep:** `src/app/use-remembered-locale.ts` — the profile's `locale` is applied once on
  load; the shell's toggle writes it back (one of the three self-updatable columns).
- [x] `I53.23` **The deliverable picker is English-only in the Arabic UI** (found 21 Sep, the Arabic
  walk). `useDeliverableCatalogue` (`deliverable-types-api.ts`) builds every `PickableDeliverable`
  from `nameEn` and the category's `nameEn`; `name_ar` exists on all 260 rows and is never read.
  An Arabic-speaking account manager typing «إعلان على وسائل التواصل الاجتماعي» is offered nothing;
  the code (`ADV-003`) or the English name is the only way in. Fix: name by the active locale
  (`i18n.language`), search both names; the chip and the picker list follow.

  **Built 21 Sep:** `useDeliverableCatalogue` names each entry in the interface language and
  carries the other name as `nameAlt`; `rankDeliverables` and the picker's commit search both.
- [x] `I53.24` **In the Arabic UI, some dates stay in English** (seen 21 Sep, the Arabic walk). The
  phase strip prints «٢٢ أيلول – ٢٨ أيلول ٢٠٢٦»; the same page's deliverable table prints "Sunday, 11
  October 2026" in its due column, and the provenance line "Monday, 21 September 2026". Two date
  formatters, one of them not reading the locale. Also on that tab: the department brief's field
  labels (THE TASK, DELIVERABLE TYPE) show in English — the seed's templates carry no `label_ar`,
  which is data, not code; the walk's Arabic screenshots show both.
  **Built 21 Sep:** `formatIraqDate` / `formatIraqDateTime` / `formatDeadline` / `formatMoment` /
  `iraqZoneLabel` default to the page's language (`<html lang>`) — twelve call sites named none.
  The template labels are seed data (no `label_ar`), left as is.

- [x] `I53.25` **Wizard step 4 — the Deliverable column was taller than its row and its picker sat
  above the row's other controls** (Edward, 21 Sep, on production after the merge: *"the
  deliverable column is not aligned with the remainder of the row and is too large"*). The first
  cell holds the picker, the catalogue line, the "proposed" badge and the model's note over
  three or four lines; cells were middle-aligned. Fixed 21 Sep: every cell of that table aligns
  to the top so the controls share one line; the column is bounded (24 %, max 280 px); the badge
  sits under the catalogue line and the note is clipped to two lines with the whole on hover.
  `BriefWizard.tsx`, `index.css` (`.wizard-deliverables`). **The sideways-scroll wrapper added
  with it was REMOVED the same evening** (Edward: *"the fix you implemented hides the deliverables
  dropdown"*): `overflow-x: auto` clips vertically too, and the picker's list is positioned
  outside its cell. On a narrow window the Owner and Actions columns clip as they did before.

- [x] `I53.26` **On a department tab, "Tasks" seemed to do nothing** (Edward, 22 Sep, production:
  *"on the Dpt tab I cannot see the tasks for each deliverable"*). It did open — the link turned
  into *Close* — but the task list rendered BELOW THE WHOLE TABLE, off-screen on a department with
  several deliverables, with nothing to say it was there. Fixed 22 Sep: the list opens in a row
  directly under the deliverable that was pressed and scrolls into view. `CampaignPage.tsx`;
  `campaign-rings` / `campaign-approval` coverage green.

- [x] `I53.27` **The wizard shows the tasks a proposed deliverable will produce** (Edward, 22 Sep:
  *"the proposed deliverable does not display the proposed task list... how can the task list be
  approved if it cannot be reviewed?"* — options a + b). Tasks are written by the database at
  Approve (ADR-0067, ADR-0052), so during the wizard there was nothing to show and the account
  manager approved blind. Built 22 Sep (branch `feat/wizard-task-preview`): `previewTasks`
  (`src/lib/deliverables/task-preview.ts`) composes the materialiser's own titles from the type's
  template steps — `<step> — <name>`, a unit number on the creation step when quantity > 1 —
  and `TaskPreview` folds it under the row as *n task(s)* on step 4 and under every deliverable at
  Review (department tabs and All deliverables); a type with no template says *No task list*; a
  row with no catalogue entry shows nothing. Read-only: the real list is still reviewed and edited
  on the department tab. `useWorkflowSteps` now carries `repeats_per_unit`. Unit tests (helper,
  wizard); `campaign-phases` coverage presses it at both steps; guide 12.

- [x] `I53.28` **Every permission refusal read "outside your write scope", whatever the database
  said** (Edward, 22 Sep, production: a team lead refused an assignment of her own team member on
  an approved campaign, the screen naming the wrong cause). `classifyWriteFailure` and the booking
  dialog mapped EVERY 42501 to the generic reach sentence — the RPCs' own worded reasons ("this
  department has not approved its brief yet…", "you cannot assign this task: X is outside…",
  "editing this task requires project-task management permission") were thrown away, so the
  real check could not be told apart from a scope problem. Fixed 22 Sep on `main`:
  `refusalSentence()` — a worded 42501 is shown as written; only a bare RLS refusal ("row-level
  security", "permission denied") keeps the generic sentence (ADR-0092 d.2 refined). Unit-tested.
  The lead's underlying refusal is still to be read from the sentence her next attempt shows.

- [x] `I53.29` **A deliverable's unassigned tasks did not follow its owner** (Edward, 22 Sep,
  production: a team lead refused an assignment of her own team member — the deliverable's owner
  was in another department, so its tasks were that department's work and outside her reach,
  ADR-0060 d.9; the AM changed the owner to a Creative lead and the deliverable moved, but its
  nineteen unassigned tasks kept the old department, so she was refused again). Fixed 22 Sep:
  `20260922110000` — an AFTER trigger on the owner/department change restamps the UNASSIGNED
  tasks' department and clears their team; an assigned task keeps its assignee's (ADR-0060 d.7);
  plus a correction for rows already left behind (unassigned tasks whose department differs from
  their deliverable's), count raised as a NOTICE. pgTAP 140; 074's fixture given a real owner.
  **Also seen:** after the change the campaign's Creative brief gate closed — Creative had no
  approved brief on that campaign; the department lead or AM generates and approves it (I53.22
  shows it on My Work). Design question left open: should a lead be able to assign ANY task on an
  approved campaign to a person within her reach, the task's department following the assignee?
  Answered the same evening — I53.30.
- [x] `I53.30` **A lead assigns any task to someone within her reach** (Edward, 22 Sep: *"implement
  the second fix where all leads can assign tasks irrespective of deliverables owner"*; ADR-0060
  addendum 22 Sep). `20260922120000` re-emits `update_task_assignment`: assigning needs
  `project_tasks:manage` and the ASSIGNEE within reach (the existing resource test — outside it is
  a request, ADR-0087); which department owns the deliverable no longer gates it; the task's
  department follows the assignee (d.9 first half). Unchanged: campaign approved (ADR-0048 d.8),
  department brief approved (ADR-0072 d.6), reviewer required (ADR-0043 d.4). An EDIT with no change
  of assignee still needs the task within reach. pgTAP 141 (allowed / request / brief gate / edit
  refused / edit after taking on / member refused); 140's "before: refused" step retired.

### I74 — The Schedule rework and the piece's tasks, to Figma L and N (3 Oct, Edward; ADR-0139/0140/0141/0142 accepted 3 Oct)

Mapped 3 Oct against Figma L (`1830:934`, SC-01…SC-30) and N (`1954:1276`, CP-01…CP-12); eleven answers, one at a time.
The four ADRs were accepted the same day. **Built 3 Oct on `schedule-rework`** (migrations `20261003110000`–`20261003180000`,
pgTAP 218–223; browser specs `e2e/local/coverage/{schedule-booking,schedule-asks,task-editor,campaign-assign,change-ask,reopen-amendment,block-time,more-time,legacy-windows}.spec.ts`,
each with the refused side). Deploy after merge: the migrations, `subtask-schedule` (the hours spread), `notify-email` (new notices).

**Booking outside your own team is a request (ADR-0139)**
- [x] `I74.1` A team lead books her own team, a department lead his department, Traffic and Power Admin anyone; everyone
  else asks — `app.resource_in_scheduling_scope` narrowed; pgTAP 140, 141, 147, 098 rewritten. (3 Oct, `20261003110000`;
  pgTAP 010, 027, 098, 141, 147 rewritten — 140 holds unchanged — and 218 added. The client mirror is `I74.6`.)
- [x] `I74.2` A request names a team, the person optional ("the lead decides"), with hours, needed-by and a note; the
  brief and files go with it (SC-04, SC-15) — `sub_task_assignment_requests` extended.
- [x] `I74.3` Who answers: the Team Leader; the Deputy only when the leader is on leave that day; no team or no leader →
  the department lead. (3 Oct, `app.task_request_answerers`, `20261003110000`; pgTAP 218.)
- [x] `I74.4` Book / offer another day / say no; the asker's "Asked of other teams" and the ⏳ chip; withdraw (SC-18,
  SC-19, SC-29, SC-30).
- [x] `I74.5` Unanswered after 4 working hours (a setting) → Traffic and the department lead, first to act settles it.
- [x] `I74.6` The grid shows the viewer's reach — a team lead her team (SC-01).

**Every task has an Edit; the campaign page assigns (ADR-0140)**
- [x] `I74.7` A pencil (Edit) beside the ✕ (delete) on every task. One task editor for every detail — name, notes, hours, person, days, waits for (several), reviewers, review
  — from the piece panel row, the Schedule chip (SC-26) and the task page; Edit all tasks (SC-21).
- [x] `I74.8` The piece's owner edits every task on it (Traffic, Power Admin too); another team's person or days go to
  that team's lead as a request.
- [x] `I74.9` A started task: every field editable; moving days or person asks first; no remove.
- [x] `I74.10` The piece panel assigns once the list is approved — Who and Dates per row, free hours, Ask another team,
  tick-and-give (CP-04, CP-05, CP-10–CP-12).
- [x] `I74.11` Cancelling a booking returns the task to To book and tells the assignee and their lead (Edward, 3 Oct — not
  the account manager as SC-24 draws); remove unbooked
  with undo (SC-16); remove booked, asked inline (SC-27).
- [x] `I74.12` The suggested list before approval: rename, hours, remove with undo, add your own, waits-for chained from
  the workflow (CP-01–CP-03, SC-11–SC-13).

**Only the account manager changes a deliverable (ADR-0141)**
- [x] `I74.13` Re-gate `edit_piece_directly`, `change_deliverable_type`, `update_campaign_deliverable`,
  `update_piece_details`: the account manager, account director, Traffic, Power Admin. (3 Oct, `20261003130000`: the
  edit guard and `app.may_edit_deliverable`, hint `ask_account_manager`; pgTAP 126, 128, 131, 166, 177, 202, 203
  rewritten, 220 added.)
- [x] `I74.14` "Ask Inas to change it" — one form (CP-06), from the piece and from any move past the due date, filled in.
- [x] `I74.15` Waiting / withdraw / 4 working hours to the account director; accept, change it, keep it (CP-07–CP-09).
- [x] `I74.16` Retire the per-task extension request into the form (ADR-0088): dialog, Needs-you card, emails.
- [x] `I74.17` The Schedule's Asks: a maker asks her lead for more time ("Lujain wants Wednesday too" — SC-01).

**A client amendment re-opens the task (ADR-0142)**
- [x] `I74.18` Re-open as Client amendment (ADR-0103's route, a kind on the reason).
- [x] `I74.19` Every re-opened task — an amendment or not — goes back to the person who made it, booked on their week;
  the team lead may reassign (reverses ADR-0121 d.1–d.2).
- [x] `I74.20` The amendment count on the piece, the campaign and the client; Block time keeps Leave and Internal only.

**The Schedule to Figma L (no rule change)**
- [x] `I74.21` To book — the pieces waiting, waiting-since, search, client and campaign filters, codes (SC-01, SC-02b).
- [x] `I74.22` (Edward, 3 Oct: reviewers are chosen with the existing picker — several, the first mandatory, the rest
  optional, the optional answering before the mandatory one; no default, nothing about reviewing changes.) Book the tasks — pick a piece, click a day; every task with hours, who, dates, waits for; warnings never
  block; select all (SC-02–SC-06, SC-11–SC-14, SC-17, SC-03b, SC-03c).
- [x] `I74.23` The Brief and Files tabs in the booking window; add a link to the piece's working files (SC-07–SC-09).
- [x] `I74.24` Free hours per person and per day; Full / over; the weeks menu with how full each week is (SC-01, SC-20).
- [x] `I74.25` Block time — Leave and Internal work, counted in the person's hours (SC-22, less Amend).
- [x] `I74.26` A lead's My work: asks from other teams on top, with the time left (SC-28).

- [x] `I74.27` **Polish found reviewing the build (3 Oct):** Block time's Who and date boxes are native browser controls, not the
  Figma's pickers (SC-22); the task pop-up's subtitle reads "Booked for Zubaida · Thu 8 Oct · 0.7h" (last day, hours a day) while
  its fields say "Sun 4 – Thu 8 · 3.5h" — say the span and the total (SC-26).
  **Fixed 4 Oct:** Block time's Who and Dates are the Schedule's own `PeoplePicker` / `DatesPicker` (the ones a task's Edit uses —
  one dates box for the span, as there), each person with their free hours (`usePeopleWeek().optionsFor`); a past day stays
  pickable (leave is recorded after the fact); the calendar keeps the weeks it opened on. The pop-up's subtitle reads the task's
  span and total hours, as its fields do ("Sun 4 – Mon 12 · 2h"). `coverage/block-time.spec.ts` 4/4 (no `select` or date input
  left in the window); the walks' Block time steps use `blockTimeFill` (`e2e/local/helpers/i74.ts`).

- [x] `I74.28` **A piece's owner cannot add a link or file to her own piece's folder** (found 4 Oct by the review walk, Figma SC-09):
  the Library lets a team lead change a client's files only through an open task her team holds (`library_client_in_reach`);
  owning the piece does not count, so the booking window's "Add a link" is refused ("you cannot change this client's files")
  until her team holds a task of that client. **Edward, 4 Oct, A "for now":** the deliverable's owner may add links and
  files to that deliverable's own folder (Deliverables › <code name>), nowhere else in the client. The Library's folder
  structure is being discussed with the team leads (4 Oct) — this may change with it.
- [x] `I74.29` **The review report has no built screenshot for step 7.6** (CP-05, everyone booked and one ask) — re-shoot.
  **Checked 4 Oct:** the report of 4 Oct 08:21 (`Claude outputs/reports/2026-10-04-schedule-rework/`) has both — `041-cp05.jpg`
  beside CP-05 and `042-cp05-list.jpg` beside mock-up 4. That run predates I74.39 and I74.42, so its task names and first names
  are the old ones: the whole report is re-shot under `I74.49`.
- [x] `I74.30` **A team member's Schedule shows every department under "Your team"** — her role books nobody, so the view
  falls back to everyone (`team-reach.ts`, the UI never blocks). **Edward, 4 Oct: relabel to Everyone** — anyone whose role
  books nobody directly (team member, account manager, account director) is not offered "Your team"; the page opens on
  Everyone. Built in `SchedulePage.tsx`.

- [x] `I74.31` **Renaming a deliverable left its per-unit task on the old name when the quantity is 1** (Edward, 4 Oct,
  testing locally: "Digital banner ×3" showed "Create Artwork — Social Advertisement"). A per-unit step is named without its
  unit number at quantity 1, and the rename looked only for "— <old name> 1". Migration `20261004110000`, pgTAP 225.
- [x] `I74.32` **Found testing locally (Edward, 4 Oct):** Save in a task's pop-up (Schedule) and in Edit did not close the
  window — it now closes (Edit all tasks stays open; a move past the due date opens the change form instead); clicking a
  day on a person's row opened the booking window with nobody and no day chosen — every row now comes in with that person
  (from the viewer's own team) and that day, and picking a person on a row with no days gives it the clicked day.

- [x] `I74.33` **Raising a deliverable's quantity left unit 1 without its number** (Edward, 4 Oct: "Harbor Line Static Posts"
  1 → 4 gave "… Static Posts", "… 2", "… 3", "… 4"). Edward, Q17 **C**: tasks keep the deliverable's name — users give
  deliverables sensible short names — and every unit is numbered when there is more than one. A quantity change now
  renumbers the per-unit tasks (back to none at 1); the ones left behind are repaired. Migration `20261004120000`, pgTAP 226.

**Languages — Edward, 4 Oct (Q18–Q20), ADR-0117 addendum.**

- [x] `I74.34` **A campaign or single job must have at least one language** (Edward, Q19: no default, the person picks one or
  more). Step 2 of the wizard and the single job's who-and-when will not go on without one and say so, in a line under the
  picker and in the refusal. The database refuses a campaign leaving draft with none (the submit and the one-shot create,
  hint `campaign_languages_required`); drafts may still be saved empty; campaigns already past draft with none are left as
  they are and listed by `scripts/db/campaigns-without-language.sql`. Migration `20261004140000`, pgTAP 228;
  `BriefWizard.test.tsx`, `single-job.test.ts`; `e2e/local/coverage/deliverable-languages.spec.ts`.
- [x] `I74.35` **A deliverable's own languages, with the existing picker** (Edward, Q18: it starts with its campaign's; a
  language added to it is its own). `deliverables.languages` replaces `deliverables.language` (backfilled: its one language,
  else its campaign's; then dropped); a new deliverable with none takes its campaign's. The deliverable panel's language select is
  the LanguagePicker (chips, remove icon, Add language); at least one stays (`languages_required`); any code on the
  tenant's list (`language_unknown`); same gate as ADR-0141 d.1 — the owner and a team member read the languages, they do
  not change them. Shown in words on the grid, the header strip and the booking window's Brief tab.
  `update_piece_details(…, p_languages text[], …)`. Migration `20261004130000`, pgTAP 227 (and 152, 204 moved to the list);
  `CampaignPage.test.tsx`, `language-words.test.ts`; `deliverable-languages.spec.ts`.
- [x] `I74.36` **The translation task follows the deliverable's languages** (Edward, Q20 A). A change of languages renames
  "Translation — ‹deliverable› (English, Arabic, Kurdish)" and tells its assignee (`translation_languages_changed`, bell and
  email in English and Arabic); a deliverable with a task list and no translation task gets one, straight after Write Copy.
  Migration `20261004130000`, pgTAP 227; `deliverable-languages.spec.ts`.
- [x] `I74.37` **Found 4 Oct building I74.36: renaming a deliverable leaves its translation task on the old name.** The rename **Fixed 4 Oct:** migration `20261004150000` — the rename reaches "Translation — <name> (…)" too; pgTAP 225.
  cascade (`app.tg_deliverable_rename_cascade`) matches titles ENDING in "— ‹old name›"; the translation title ends in
  "(languages)", so "Translation — Key visual - summer range (Arabic, English)" keeps the old name after a rename. Edward to
  confirm it should follow the name too.
- [x] `I74.38` **Found 4 Oct on a clean local reset: three browser specs fail for reasons that are not languages.**
  `coverage/campaign-wizard.spec.ts` mocks `asset-url` with an object key outside the tenant (`e2e/…`), which
  `20261002130000` refuses ("a stored file must be inside its own tenant"), so step 2's file and every later test fail;
  `coverage/campaign-phases.spec.ts` adds deliverables without choosing a workstream (ADR-0116 d.3) and calls
  `save_workstream` without `p_campaign`; `coverage/wizard-dialogs.spec.ts` names a Creative team lead as owner of a deliverable in
  a Content workstream (I66.9 offers only that department's leads).
  **Fixed 4 Oct (specs only):** `campaign-wizard` keys its stand-in upload inside the folder's tenant and client, as `asset-url`
  does; `campaign-phases` — its `save_workstream` call already carried `p_campaign`, and failed only because the test before it
  stopped (no campaign id): a promoted job now has its own workstream (I68.16), so with the one the test adds the dialog rightly
  asks which, and the spec chooses "Launch visuals"; `wizard-dialogs` names each piece's owner from its own workstream's
  department (Dev Copy Lead for Content, Dev Studio Lead for Outdoor/Production). The three specs: 42 passed.

**Task titles — Edward, 4 Oct (ADR-0071 addendum).**

- [x] `I74.39` **A task's title names its campaign and type, not the deliverable** (Edward: the deliverable's name "is already
  displayed at the top of the form"). Once per deliverable "<Step> — <Campaign>"; per unit "<Step> — <Campaign> · <Type> <n>"
  (no number at quantity 1; no type: the number alone); "Translation — <Campaign> (<languages>)". Titles follow a campaign
  rename, a type change, a quantity change and a languages change (the translation task's assignee told); a deliverable rename
  changes none; a hand-named task is left alone. Replaces d.10 / d.10a and I74.31 / I74.33 / I74.37 (I57.48 kept: no count).
  Existing titles the old rules wrote rewritten once (hand-named untouched). Also: a quantity changed by an accepted change
  request now adds and cancels the unit tasks (it changed only the number). The wizard's task preview composes the same rule.
  Migration `20261004160000`, pgTAP 229 (225, 226, 227 moved to the rule); `task-preview.test.ts`, `task-title.test.ts`,
  `team-view.test.ts`; `deliverable-languages.spec.ts`, `campaign-phases.spec.ts`. **Built and tested 4 Oct:** verify.sh 227
  files / 3,238 tests; vitest 257 / 3,974; on a fresh reset deliverable-languages 3/3, change-ask 9/9, campaign-one-page 8/8
  (both fixed for I74.35's languages list), campaign-phases' wizard preview and rename steps pass (the rest of that file is I74.38).
  Backfill on the long-lived local database: 100 of 104 tasks rewritten.
- [x] `I74.40` **Found 4 Oct on a clean reset running the I74 coverage specs — specs written before I74.32 / ADR-0140 / the 4 Oct **Resolved 4 Oct:** all specs, not product — rewritten to ADR-0139/0140 and I74.32 (schedule-page 8/8, task-editor 10/10, schedule-booking passing); one product fault found on the way: the dates calendar restarted the range when the already-chosen day was clicked (fixed in `DatesPicker.tsx`).
  Library change, not title-related:** `coverage/task-editor.spec.ts:97` waits for "Saved." though Save now closes the pop-up
  (I74.32), and 9 tests after it are skipped; `coverage/schedule-page.spec.ts:252` waits for `edit-title` in the booking's edit
  window (2 more time out or lose their fixture after it); `coverage/task-page.spec.ts:266` waits for `asset-file-input`;
  `coverage/schedule-booking.spec.ts:183` "starts on the first day picked" reads 2026-10-07 for 2026-10-06 (5 skipped after it).
  Each needs tracing to spec or product before it is fixed.
- [x] `I74.41` **Found 4 Oct walking Edward's test script (step 14): the Schedule pop-up opened a BOOKED task as unbooked, and
  Save took the person off.** The pop-up read the deliverable's task list from memory (30 s), and the booking window's writes
  refreshed only the Schedule's own reads; when the fresh read landed with the form open, the form measured its stale draft
  against it and sent "take her off". **Fixed 4 Oct:** every booking write (book window, drags, create/move/cancel booking, undo)
  refreshes every task view (`invalidateTaskViews`); the pop-up reads fresh on every opening and waits — "Loading…" — while its
  read disagrees with the booking (`popup-read.ts`); the editor keeps what it LOADED and moves to a fresh read keeping only the
  user's own edits (`rebaseDraft`), so Save never sends a person, days or hours the user did not touch. Tests:
  `TaskEditor.test.tsx` (2, fail on the old code), `task-edit.test.ts`, `popup-read.test.ts`; walk step 14.
- [x] `I74.42` **Found 4 Oct (steps 18, 20): the I74 screens name people by first name only** ("Dev asks…", Who "Dev", "Booked 5
  tasks for Dev", "Anyone — Dev decides") — against I66.1. `full-names.test.ts` looked only for the nickname fallback.
  **Fixed 4 Oct:** full names on the ask cards, answer window, more-time button and card, Who chips and pickers, toasts, the
  pop-up, the task list; the scan now refuses any first-word cut of a name (`split(' ')[0]`), an exception saying so on the line
  above (the My work greeting to its own reader; a weekday).
- [x] `I74.43` **Found 4 Oct (step 29): raising a quantity lists the units out of order** (Billboard 2, 3, 1): added units took
  the template step's number while the list's had moved down one for the translation task. **Fixed 4 Oct:** migration
  `20261004170000` — a unit brought back or added takes its step's place on THIS list (`app.unit_step_position`); existing rows
  repaired. pgTAP `230` (fails on the old code).
- [x] `I74.44` **Found 4 Oct (step 24): the owner's view of an accepted change ask did not say the new due day**; and the
  read-only line could show an old accepted ask's day instead of the deliverable's own date. **Fixed 4 Oct:** "… accepted ·
  due now Thu, 5 Nov"; the line always shows `deliverables.due_at`. `PieceChangeAsk.test.tsx` (fails on the old code).
- [x] `I74.45` **Found 4 Oct (step 1): before approval the translation task read "Not booked", not "Suggested"** (and the banner
  said "6 suggested and 1 of yours"). **Fixed 4 Oct:** the generated translation task is part of the suggestion
  (`isSuggestedTask`, the database's own "Translation — " mark). `task-edit.test.ts`.
- [x] `I74.46` **Seen 4 Oct in the walk:** (a) after the account manager answered an ask her panel's due date kept the old day
  and "Save the deliverable" lit — the panel's untouched fields now follow the saved deliverable (`follow-saved.ts`,
  `PiecePanel.test.tsx`); (c) her booking window read "Book 1 task" when every pick of hers is an ask — the button counts what
  will happen ("Send N asks", `bookButtonCounts`, `book-plan.test.ts`); (d) screens said "piece": every English string now says
  "deliverable(s)" (175 strings), and the 95 Arabic ones that said قطعة say المُخرَج. (b) is I74.44.

- [ ] `I74.47` **The task editor's calendar moves under the pointer** (found 4 Oct fixing I74.27). Its `DatesPicker` starts on the
  Sunday of the chosen start day (`TaskEditor.tsx`, `startSunday={sundayOfIso(draft.from …)}`), so picking a start day in the
  second or third week shifts the three weeks before the end day is clicked, and a paged-forward calendar jumps again. Block
  time keeps the weeks it opened on; the editor (and the booking window, if it does the same) should too. Not changed — asked.
- [ ] `I74.48` **Answering an ask still has the browser's date boxes** (`AnswerAskDialog.tsx`, From and To) — the same polish as
  I74.27, on the window a lead answers an ask in. Not changed — asked.
- [ ] `I74.49` **Re-shoot the Flows L and N report** (`schedule-rework.walk.spec.ts`) on a fresh local reset, so it shows the
  build as it is: the task names (I74.39), full names (I74.42), Block time (I74.27). Needs `supabase db reset` locally — which
  removes whatever is on the local database — so it waits on Edward's yes.
  **Done 4 Oct (Edward: "reset the database and rerun all tests and the walkthrough report").** Two local resets.
  `schedule-rework.walk` 60 steps, 119 checks, 0 failed — after one walk fix: the story set has five tasks since the translation
  task (I74.36) and the walk gave hours to four, so the server rightly refused the fifth (`hours_required`). `test-script.walk`
  brought to I74.42's full names (steps 32, 33) and to two stale reads (steps 20, 24; I74.50, I67.5).
- [ ] `I74.50` **The asks a lead sent are left out of the live refresh** (found 4 Oct, test-script step 20). When another team's
  lead answers, "Asked of other teams" still reads "Waiting" until its 20-second re-read (`useAsksISent`, LIVE): the I67.2
  signal refreshes `TASK_VIEW_ROOTS` (`src/lib/query/task-views.ts`), and `task-asks` is not one of them. Adding it would make
  the card turn on the answer. Not changed — asked.
- [x] `I74.51` **The account manager is offered "Approve N tasks" and the server refuses it** (found 4 Oct tracing the full local
  run, f-task-list F2). The piece panel shows its task controls, Approve included, to anyone holding `project_tasks:manage` and
  `bookings:create` (`PieceTasks.tsx:86`, `mayEdit`) — the account manager holds both. `app.may_approve_deliverable_tasks` allows
  only the owner, or `deliverable_owner:manage` within write scope, and `app.in_write_scope` for an `account` scope is true only
  for a named account manager — none is passed — so `approve_deliverable_tasks` refuses her (42501; `20260912110000`, ADR-0100).
  The button should follow the server's rule. Not changed — asked.
  **Fixed 4 Oct (Edward: "the deliverables owner, other team leads from the same department and the department lead"; yes
  to the Traffic / Power Admin failsafe; yes to deputy team leads — ADR-0100 addendum).** Migration `20261004180000`:
  `app.may_approve_deliverable_tasks` is the owner, or a role that books whose reach is the organisation, a department or a
  team inside the deliverable's department — so the department's leads and deputies, Traffic and the Power Admin; not the
  account manager, the Account Director, another department's leads or a C-level role. pgTAP 231 (17); suite 3,261. The
  panel's Approve reads `can_approve_tasks` (`PieceTasks.tsx`), its note no longer says "the owner approves";
  `PieceTasks.test.tsx` (fails on the old gate). In the browser (local): offered to Dev Team Lead, Dev Motion Lead, Dev
  Deputy Lead, Dev Dept Lead, Traffic; not to the account manager, the Account Director, Dev Copy Lead, Dev Content Lead;
  Dev Team Lead (not the owner) approved "Social statics". **Seen, not changed:** the account manager still has the task
  rows' pencil, ✕ and hours on another department's list, and the server accepts her edits (`save_sub_task`) — closed
  by `I74.53`.
- [x] `I74.53` **The account manager edits no deliverable's tasks** (Edward, 4 Oct: "AM should not edit other departments'
  tasks either"; ADR-0140 addendum). Seen fixing I74.51: on her own clients' work she had the pencil, ✕ and hours and the
  server saved them — every task write passed `app.deliverable_account_manager(…)` into `in_write_scope`. Migration
  `20261004190000`: null in the three `sub_tasks` policies and in `remove_sub_task`, `resequence_deliverable_tasks`,
  `update_task_assignment`, `sub_task_cancel`, `sub_task_reinstate` (each re-created from its current definition with only
  that argument changed). Her deliverable changes still regenerate and rename tasks (SECURITY DEFINER paths), her asks for a
  person stay. Screens: `mayEditTasks` (`deliverables/lib/task-edit.ts`) — the campaign page's rows read-only for her (Who
  and the ticks stay — asks), the Schedule pop-up shows the task without the editor ("Only the deliverable's owner and its
  department's leads change its tasks."). pgTAP 232 (12) and 010 (now a refusal); suite 3,273; unit tests (fail on the old
  gate). Browser (local): the account manager — no pencil, ✕, hours or Add a task; her rename and a quantity 6 → 7 saved
  (seven Create Artwork tasks); the pop-up read-only. The team lead keeps every control.
  **Then found (the browser specs):** her asks broke — every asking screen saved the reviewer onto the task first, a task
  edit now refused. **Edward, A: the ask carries its hours and who checks it.** Migration `20261004200000`:
  `request_task_booking` takes `p_reviewers` / `p_review_mode`, the ask records them, and the booking writes them onto the
  task (`answer_task_request` and `take_task_offer` already passed them on). The booking window, the panel's ask and the
  task editor's ask send the reviewer in the ask and no longer save the task first — for every asker. pgTAP 232 now 19
  (her ask accepted, the ask records the reviewer, the task untouched, the lead's booking writes it, an ask naming nobody
  refused); suite 3,280. Browser: schedule-asks, campaign-assign, schedule-booking (her ask from the booking window) pass;
  `campaign-assign` and `schedule-asks` brought to the new order.
- [x] `I74.54` **"Approve all mine" took a colleague's list** (found 5 Oct by the-second-gate "accept all takes everything
  that is theirs, and nothing that is not"). Since I74.51 a team lead may approve any list in her department, and the bulk
  button used that rule, so Dev Team Lead's "Approve all mine" approved Dev Dept Lead's "Social statics". **Edward, 5 Oct,
  A: "mine" means owned.** `TaskListsApproval.tsx`: the bulk button takes `isMine && canApprove`; ticks and "Approve
  selected" still offer any list she may approve. `TaskListsApproval.test.tsx` (fails on the old rule). ADR-0100 addendum.
- [x] `I74.55` **A failed "Add a task" on the campaign page said only "That did not save. Try again."** (found 5 Oct by
  p-capture P2 and P3). A refusal outside reach (the row policy's bare 42501 on a new task) read as "Try again", and an
  unexpected failure never offered Report (ADR-0092 d.3) — the panel built its banners from its own `say()`, which drops
  both. **Edward, 5 Oct, A.** `PieceTasks.tsx` `fail()`: a named refusal in the reader's words, else the page's shared
  `failed()` — "outside your reach" for a refusal (not reportable), Report with its cause for anything unexpected — on
  the five banners: add, remove (both), approve, ask. Row errors (inline per row) unchanged. `PieceTasks.test.tsx` (2,
  fail on the old handling).
- [x] `I74.56` **The hand-over's "pick who checks it" step is for old data only** (found 5 Oct: deactivation-handover "a
  task with no reviewer takes one on the hand-over row" could not set itself up). Since `20260827100000` the deferred
  trigger `sub_task_reviewer_required` refuses any assigned, live task without a reviewer, for every caller, so no new
  task can reach the step (20260930143000). **Edward, 5 Oct, A:** the step stays for tasks from before August; the test
  is retired with a comment (faking the state would mean switching the database's checks off).
  **Before pushing the migrations (Edward):** the rule covers DONE tasks too (only cancelled ones are exempt), and three of
  this branch's migrations rewrite existing tasks at push time (`20261004120000` unit numbers, `20261004160000` task
  titles, `20261004170000` unit order) — any such task they touch is refused at commit and that migration rolls back. Run:
  `select t.id, t.title, t.status, t.assignee_id from sub_tasks t where t.assignee_id is not null and t.status <>
  'cancelled' and not exists (select 1 from sub_task_reviewers r where r.sub_task_id = t.id);` — no rows: push; any
  rows: give each a reviewer first (a small script, to be prepared), then push.
  **Run on production 5 Oct (Edward): no rows** — no old assigned task without a reviewer; the push is clear of this.
- [x] `I74.57` **Four controls of the retired windows lost their browser tests** (5 Oct, bringing I74.52's specs to the
  product: the old specs "covered" them only because the old deliverable window flashed before the campaign page took
  over). **Edward, 5 Oct, A.** Still reachable — only the window's Close, on ad-hoc work (none can be made since I66.10;
  production holds some): `deliverable-detail-close`, now covered by `e2e/local/coverage/adhoc-deliverable-window.spec.ts`
  (made through `create_adhoc_deliverable`; opened from the Ad-hoc tab, stays on /deliverables, Close shuts it).
  Unreachable, on the coverage baseline with reasons, to be deleted: `ExtensionRequestDialog` (`*-attribution-*`, retired by
  ADR-0141 d.5, opened by nothing), `TaskListApproval`'s `task-list-approve` and the window's owner control
  (`deliverable-owner-save`) — both drawn only on campaign work, which never reaches the window; ad-hoc work shows the
  window's short layout without them. (Found running it: the first version of the spec expected the owner control on
  ad-hoc work.)
- [x] `I74.52` **The full local browser run on a fresh reset, 4 Oct: 265 passed, 45 failed, 88 skipped — every failure traced; no
  product defect besides I74.51, none from I74.27.** Specs left behind by later rules: the retired deliverable window (I71.1,
  still open — i-scheduling I1, j-review-cycle J1, m-scheduling-rules M1, o-manual-link O1, p-capture P2/P3, l-cross-cutting L3a,
  team-view, waiting-for-you, f-task-list F1–F6); a fake upload key outside the tenant (`20261002130000` — k-my-work K6/K6b,
  p-capture P1, task-page "Already attached"); the panel as the one editor (ADR-0132 d.2/d.8 — board-and-timeline ×2,
  the-second-gate, notifications.spec); dates as words, the year only in another year (I66.8 — closures M2/M3, notification-mails
  Action 1); full names (I74.42 — task-editor); task titles without the deliverable (I74.39 — g-full-campaign G4); a deliverable's
  own languages (I74.35, `p_languages` — campaign-rings); owners from the deliverable's own department (I66.9 —
  where-is-everything). Data: library ×5 look for "Kite Card", which only the demo scripts make; campaign-account-manager matches
  "Dev Account Mgr" inside "Dev Account Mgr 2"; deactivation-handover expects the Animator to hold work the seed never gives him,
  and leaves him deactivated — which fails schedule-booking and schedule-page after it. Knock-ons: closures M4, notification-mails
  Actions 2–7. Five more failed only when the suite ran after the walks (the walks change the shared data).
  Also flaky once in four (4 Oct): `campaign-one-page` "a new type is asked first" types into Type before the panel has
  filled it, so the box reads "Social AdvertisementStatic Post" — wait for the box's value before `fill`.
  **Fixed 5 Oct (Edward: fix them).** Every spec brought to the product as it is (four helpers by file, then traced
  failure by failure): the retired window → the campaign page's panel and its helpers; upload keys inside the tenant;
  dates as words; full names; task titles; `p_languages`; owners from the deliverable's own department; the Library on
  the seed's Northwind; exact option matching; the deactivation test makes its own work and puts back both people and the
  client (the client directly — the seed's Luma Retail has no country, which the client page now requires); two retired
  with a comment where a later rule replaced the behaviour and other specs cover it (i-scheduling I3 → ADR-0139, I4 →
  ADR-0141); one retired as unreachable (I74.56). Found on the way and fixed with Edward: I74.54, I74.55, I74.57. Also
  fixed: both walks start their working week on a Sunday (run on a Monday, "from today" split it across two weeks), a
  test reading "the newest ask" now reads its own by id, and team-view's workstream test (skipped behind L7 for weeks)
  brought to the status key (I67.3). Last full run: 342 passed, 5 failed — those five then traced, fixed and run green
  on a fresh reset (47/48, then team-view 29/29). Walks: Flows L and N 119/119, the test script 135/135.

### I73 — Found after the Library release (2 Oct)

- [x] `I73.1` **A campaign task sent for review still reads "In progress" on its maker's My Work** (Edward, 2 Oct: Fadia Wael
  Anwar, three tasks — Carousel 1, Static Post 4, Static Post 1, sent 30 Sep–1 Oct). Traced: the tasks ARE `review` in the database
  and sit under "Waiting on someone else"; the row's badge (`src/features/deliverables/MyWorkPanel.tsx:130-137`) shows the
  DELIVERABLE's state for every campaign task, and a campaign deliverable stays `in_progress` while any of its tasks is open
  (`sub_task_submit` never moves it; `TaskPage.tsx` moves only a non-campaign one). Three more on production read the same way
  (three of one maker's pieces). Edward to choose what the badge shows.
  **Fixed 2 Oct (Edward, A), branch `fix-my-work-badge`:** the badge is the task's OWN status on every row ("In review", "Changes
  requested", …); only a piece approved as a whole reads "Approved". `MyWorkPanel.test.tsx` (fails on the old code).
- [x] `I73.2` **A live campaign or job can be renamed** (Edward, 2 Oct: "Is there any way to change the campaign name?" — only
  as a draft; A). ADR-0137. A pencil beside the name on the campaign page (`RenameCampaignDialog`), for its approval authority;
  migration `20261002140000` (`campaign_name_guard` + `rename_campaign`) — also closes a PATCH that renamed at any status;
  pgTAP 216 (10); `CampaignPage.test.tsx`; `e2e/local/coverage/campaign-rename.spec.ts`. Built on `main` (Edward).
- [x] `I73.4` **The campaign form's account manager box offered team leads, not account managers** (Edward, 2 Oct: a user
  assigning the account manager on a campaign saw team leads). Cause: since the 23 Sep wizard rework (I56.3) the box on step 1
  drew from the deliverable-owner list — department and team leads, mixed with a few account managers — instead of
  `useAccountManagers` (holders of `account_manager:manage`), which the campaign page's own Change already used. Fixed on main:
  `BriefWizard.tsx` offers the account managers, and the review names the approver from that list. Tests: `BriefWizard.test.tsx`
  (offers the account managers, not the leads — fails on the old list), `e2e/local/coverage/campaign-account-manager.spec.ts`
  (no active department or team lead is offered — fails on the old list). Production offers 9 people: 6 account managers, the
  account director and the 2 power admins.

- [x] `I73.3` **The AI proposes no deliverables in the single job or the campaign brief** (Edward, 2 Oct: "since the UI changes for the
  single job and campaign brief"). Production: `generate-deliverables` has no invocations; OpenAI shows requests for other work.
  Ruled out: the OpenAI key (credit, unchanged since 27 Aug), Supabase's platform keys (the legacy anon key still answers 200), the
  function itself (a local run of the campaign wizard — step 1, a typed proposition, Next — calls it and shows the proposal), and
  today's releases (nothing on either path changed). **Traced 2 Oct:** production has had NO campaign started since 26 Sep (six single jobs, no campaign
  draft), so `generate-deliverables` was never asked; the single job has never asked the model at all — "New" and the door
  default to Single job. Edward chose C: he confirms the campaign wizard on production; the single job gets the suggestion.
  **Built 2 Oct, branch `single-job-pieces` (ADR-0138):** the brief suggests on reaching "Who and when" (the call moved to
  `src/lib/brief/generate-deliverables.ts`); a further piece may have its own department, owner and due day, warned as
  "reads like a campaign". Tests: `SingleJobWizard.test.tsx` (2), `single-job.test.ts` (2), `e2e/local/coverage/single-job-pieces.spec.ts`.

### I72 — The Library to Figma section K, with every file action (1 Oct, Edward; ADR-0134/0135/0136 accepted; branch `library-redesign`)

Edward, 1 Oct: *"we will work on K - Library, we need to revise the UI as per the design in the Figma file… add color tokens
and any reusable components required that are missing to the repo design system… when complete I need side by side shots
of the implementation against the figma design."* Then: *"let's address all the actions first"* — 27 actions and three
notes (resume, office archive, links) answered one at a time; the answers are the tables in the three ADRs. Frames:
section K `1636:497` — LB-01 by client `1636:500`, LB-02 a piece's folders `1636:697`, LB-03 a brand `1839:2`, LB-04 inside a
folder `1839:266`, LB-05 uploading `1840:2`, LB-06 a project `1841:2`, LB-07 version history `1840:238`, LB-08 search
`1841:327`, LB-09 move `1840:464`, LB-10 delete `1840:734`, LB-NOTES `1842:113`.

- [x] `I72.1` **ADR-0134, ADR-0135, ADR-0136 accepted** (Edward, 1 Oct: "Proceed").
- [x] `I72.2` Who reads and who changes: every internal reader sees every client; writes by `assets:manage` within reach; **Built 1 Oct** — migration `20261002100000`, pgTAP 210 (47, adversarial). Reach also counts the client’s account manager and whoever opened a campaign of that client (so a job’s brief proof can be filed before any task exists) — confirmed by Edward 1 Oct (A), ADR-0134 addendum.
  delete and bring-back by the uploader / maker, the client's account manager or a Power Admin — in RLS, adversarial
  pgTAP (ADR-0134 d.1–3).
- [x] `I72.3` The standard folders locked in the database; a made folder renamed / moved by reach, deleted only empty **Built 1 Oct** — guard triggers, pgTAP 210/211; walk: a made folder added on LUMA, the standard four locked.
  (d.19–20). Replaces the cascade delete.
- [x] `I72.4` Versions: same-name upload asks (next version / keep both); history panel (LB-07); make an older version **Built 1 Oct** — RPCs `library_add_version` / `library_make_current` / `library_versions`; walk: v1 made current became v3.
  current = a new version (d.7, d.12).
- [ ] `I72.5` The file menu: Preview, Rename (extension fixed), Move to…, Copy to…, Copy link (d.5–11). **Built 1 Oct; verified in the browser with the bucket stood in** (preview box, download, rename, move, copy, copy link); not yet against the real B2.
- [x] `I72.6` Delete → per-client Recently deleted, 30 days, then removed from storage by a daily sweep; the warning that **Built 1 Oct** — `library_delete` / `library_restore` / `library_recently_deleted`, `library-sweep` (daily, not yet scheduled); walk: deleted and brought back.
  names pieces using the file (d.9).
- [ ] `I72.7` Upload box: progress per file, 5 GB refusal, multipart with resume for 24 h, uploads carry on in a corner **Built 1 Oct; verified in the browser with the bucket stood in** (progress, done, the clash both ways, a refused file in the corner box); parts and resume unit-tested only; not yet against the real B2, which also needs the CORS rule exposing `ETag` (RUNBOOK).
  box across Maestro (d.12–14); `asset-url` signs multipart.
- [x] `I72.8` Links as rows with versions and an optional expiry; the two-day notice and "Link expired" (d.16–18). **Built 1 Oct** — `library_add_link` / `library_add_link_version`, notice `link_expiring`; walk: a Google Drive link with an expiry.
- [x] `I72.9` A folder per piece; every review version shown there with its review state; optional working files on send **Built 1 Oct** — piece folders made and backfilled (205 locally), `library_piece_folders`, "Add working files" on the task page; walk: a piece with four review versions.
  for review; proofs marked (d.22–25, amends ADR-0023 d.1).
- [ ] `I72.10` Grid view with pictures made in the browser at upload (`pdfjs-dist`, Apache-2.0) (d.26). **Built 1 Oct; pictures NOT verified** — they upload beside the file, which needs B2. The grid’s kind tiles verified.
- [x] `I72.11` Search: every client, full path, kind and client filters, opens the folder with the file picked out (d.27). **Built 1 Oct** — `library_search` / `library_search_counts`; walk: a result opens its folder with the file picked out.
- [x] `I72.12` Look-alike project folders flagged with both jobs; closing the duplicate moves its files (d.21). **Built 1 Oct** — flag in `library_client_overview`; a closed duplicate folds its files into the job that stays (pgTAP 212). No look-alike pair can exist locally once ADR-0135’s index is on, so the walk does not show the flag.
- [x] `I72.13` ⚠️ Names equal ignoring capitals and spaces are refused (ADR-0135). **Waits on Edward:** run the **Built 1 Oct** — migration `20261002110000` refuses to apply while a pair exists; `scripts/db/lookalike-names.sql`; pgTAP 213. A closed duplicate is marked `merged_into_id` so it no longer holds the name. **Pushed 2 Oct (Edward):** the one live pair — the draft "Borderless card" (9bd0b6d2…, a copy of "Borderless Card" made five minutes later; its two References files were duplicates) — deleted by hand; the rule is on.
  look-alike check on production and close the duplicates before the migration is pushed.
- [ ] `I72.14` Archiving 90 days after close, final files kept online, Bring back for 30 days, the 60-day review-round **Built 1 Oct, switched off** — migration `20261002120000`, `library-archive` (no transport until the office service is known), pgTAP 214; the 60-day clock retired (pgTAP 014).
  clock retired (ADR-0136). **Built switched off** — the office server's service, sign-in and structure are Edward's
  to determine (*"the office uses a service with login… I cannot remember the name"*).
- [x] `I72.15` Every screen to its frame (LB-01…LB-10); missing colour tokens and reusable components into `src/index.css` **Built 1 Oct** — 26 tokens in `src/index.css` and `E2EV1.pen`; `FileKindBadge`, `FolderGlyph`, `SegmentedControl`, `Menu`, `SidePanel` in `src/components/` and the .pen; the walk `e2e/local/walks/library.walk.spec.ts` writes `Claude outputs/reports/2026-10-01-library/REPORT.html`, each screen beside its frame (34 checks passed, 2 failed — both the missing local B2 keys).
  and `E2EV1.pen`; the HTML report with each screen beside its frame.

- [x] `I72.16` **Browser tests for every new Library control** (Edward, 1 Oct, A): `e2e/local/coverage/library.spec.ts` (5 tests — folders, uploads with the clash answered both ways and the corner box, the file menu, projects and pieces, search; the wizard's FolderPicker crumb), `library-at-scale.spec.ts` rewritten, the old Library test retired from `people-chat-library-bookings`. The bucket is stood in for in the browser (no local B2 keys); rows and rules are real. Gate: 0 new gaps; two on the baseline with reasons (`I72.12` look-alike, `I72.18` Change).
- [x] `I72.17` **Recently deleted shows a deleted link as "FILE"** — `library_recently_deleted` does not return `link_url`. Small.
  **Fixed 3 Oct, branch `fix-recently-deleted-link`:** migration `20261003100000` returns `content_type` and `link_url`; the
  screen badges from them as the folder and search lists do. pgTAP 217.

- [x] `I72.18` **"Change" in the upload box** (Edward, 1 Oct, A): opens the client's folder picker in the box (the same `FolderTree` as Move to…); files not yet sending go to the chosen folder and their clash is asked afresh there; a file already sending, done or refused stays. A brand's or a project's top level cannot be picked (d.15). `changeFolder` in `src/lib/assets/uploads.ts`, unit tests (2), the browser spec presses it.
- [x] `I72.19` **A file row could name another tenant's stored object** (found 1 Oct writing I72.16; the old Library had the same gap) — `asset-url` signs whatever key a row holds. Migration `20261002130000`: a row's object and picture keys must sit under its own tenant; pgTAP 215 (7). Test 210's made-up keys moved inside the tenant.

### I71 — Found while writing the owed browser tests (1 Oct; branch `fixes-1-oct`)

- [ ] `I71.1` **Browser specs still approve a task list on the old deliverable window.** `/deliverables?open=<id>` now forwards a
  campaign piece to the campaign page (ADR-0132 d.8), which has no `task-list-approve` / `subtask-add-open`.
  `deliverable-window.spec.ts` fails on it (re-run 1 Oct: 1 failed, 20 passed). Twelve specs open pieces that way; which of them
  fail is not yet run. Not caused by `fixes-1-oct`.
  **1 Oct, on `fixes-1-oct-2`:** all 12 specs moved to the campaign page / piece panel (`e2e/local/helpers/piece.ts`) and the task
  page's "Manage this task" for per-task controls. deliverable-window, reopen, review-rules-and-chime pass twice. The rest still
  fail on the DEMO names in the local database (the seed's "Dev …" names renamed — traps.md); they need a run after
  `supabase db reset --local`. `deliverable-close` put on the coverage baseline: only the retired window draws it.
  **The reset and re-run wait for the task-scheduling rework (Edward, 1 Oct, B)**, which touches the same specs.
- [x] `I71.2` **Traffic's "new task" booking on an approved list cannot succeed.** Reported by the test run, not yet traced: the task
  is created and the list's approval cleared (I68.5 / ADR-0132 d.4), then the assignment is refused because the list is not
  approved — leaving a stray unassigned task and a re-opened list. Edward to decide what the dialog should offer.
  **Built 1 Oct (Edward, A):** after adding the task the dialog reads the list's gate (`readTaskListGate`); when the addition re-opened
  it, it stops at "Added ‹task›. ‹owner› must approve the task list before it can be booked." and assigns nothing.
- [ ] `I71.3` **"Provisional" appears ignored on task bookings** — chosen in the dialog, stored `confirmed`. Traced 1 Oct: the
  choice reaches only a plain reservation; a task assignment is always confirmed (ADR-0060). **ON HOLD (Edward, 1 Oct):** dealt with
  in the rework of the whole task-scheduling flow, the next major task.
- [x] `I71.4` **A Department Lead booking the Strategy planner was refused "As a team lead you can only book resources in your own
  team"** — the wording names the wrong role; whether the refusal is right under ADR-0098 is Edward's call.
  **Traced and fixed 1 Oct — a defect; ADR-0098 says it goes straight through.** The dialog created the NEW task unassigned on the
  assignee's department before assigning it; since ADR-0098 a lead schedules anyone but writes tasks only in their own reach, so
  `sub_tasks_manage_insert` refused it (85 of 85 pieces offered to the Creative lead, local). Existing tasks assigned fine (22/22).
  Now the task is placed on the assignee's department only when the caller can WRITE there (`inWriteReach`), else on the caller's
  own; `update_task_assignment` moves it (ADR-0060 d.9). `schedule.outOfScope` reworded for ADR-0098 in both languages.

- [x] `I71.5` **The red ring around late bars goes; the Late tag is enough** (Edward, 1 Oct: "remove the red border around the
  late items, the late badge is sufficient"). The only ring + tag pair is the Team page's timeline (`.tv-bar-late`, `src/index.css`).
- [x] `I71.6` **The Dev panel is a permission, `dev_view:view`** (Edward, 1 Oct: one permission for the whole panel, A; C-level now,
  perhaps Department Leads for their departments later). ADR-0120 addendum (accepted 1 Oct). Migration
  `20261001110000`: the catalog entry, granted to CEO / COO / CFO (and the Power Admin, as every grant); whom a holder may view
  follows their role's reach (`app.view_as_reaches`); `view_as_options()` answers the panel for the real person. pgTAP 209.

- [x] `I71.7` **The brief's risk reminder is lost on campaign pieces** — `task-list-risk` lives only in `TaskListApproval` on the
  retired deliverable window; since ADR-0132 d.8 a campaign piece never opens it (found 1 Oct by I71.1). Restore it on the piece
  panel, or drop it — Edward.
  **Restored 1 Oct (Edward, A):** `TaskListRiskReminder` (shared with the window) above the panel's Approve while the list waits,
  dismissable per visit. `CampaignPage.test.tsx`.
- [x] `I71.8` **Four deliverables-page browser tests drive controls only the retired window has** (add form with every field,
  reorder, "unassigned only", the owner picker's Cancel) — rewrite against the panel and the task page, or retire — Edward.
  **Retired 1 Oct (Edward, B):** `test.skip` with the reason on each; the task-scheduling rework brings their replacements.

### I70 — A deactivated person's work is handed over before they go (30 Sep, Edward; ADR-0133 proposed; branch `deactivation-handover`)

Edward, 30 Sep: *"when I deactivate a user, 1. They lose access, and 2. their dept lead is notified and given a list of all items that
need to be reassigned. Once that is complete… the complete deactivation is executed."* Today deactivation blocks sign-in and switches
the calendar row off; nothing is reassigned and nobody is told.

- [x] `I70.1` ADR-0133 accepted (Edward, 30 Sep).
- [x] `I70.2` Two stages: Leaving (access lost at once; offered for no new work) and Deactivated. `update-user` starts Leaving and no
  longer switches the resource off at once. Migration + pgTAP.
- [x] `I70.3` The hand-over list (six groups: clients, campaigns and jobs, deliverables, workstreams, open tasks with bookings, reviews)
  to the department lead — for Client Services the Account Director; none or the person is the lead → Traffic Manager + Power Admins.
  Needs-you card, bell, email (EN+AR). Migration + pgTAP.
- [x] `I70.4` The hand-over page: each item handed to a named person through the field's own rule and write; open tasks stay assigned
  until handed on.
- [x] `I70.5` Completion: the list empty → Deactivated, calendar row off, the lead and the starter told. Migration + pgTAP.
- [x] `I70.6` Escalation row "Hand-over not finished" (ADR-0108): default 24 h → Traffic Manager + Power Admins.
- [x] `I70.7` Reactivating a Leaving person stops the hand-over; nothing handed on is undone.
- [x] `I70.8` Browser tests for the new controls; the Users page shows Leaving with the count still to hand over.

### I69 — A client names its account manager and can be edited (30 Sep, Edward; branch `client-am-and-edit`)

- [x] `I69.1` **The clients pages did not name the account manager** (Edward, 30 Sep). Figma CV-01 (`1634:518`) and CV-02 (`1634:723`)
  were drawn from the account manager's own view: the list had no column, the page only a "YOU ARE THE AM" chip. Edward, A: both —
  an "Account manager" column on the list ("You" on your own rows) and an "AM: <name>" chip on the client page ("YOU ARE THE AM"
  when it is you). The name was already read (`accountManagerName`).
- [x] `I69.2` **No Edit on an active client** (Edward, 30 Sep). The registration steps edit an active client (ADR-0123; Dos and
  don'ts stay the director's) but nothing linked to them. Edward, A: "Edit client" (pencil) on the client page's header for
  `clients:manage`, opening Basics; a "Back to <client>" in the editor; Cancel returns to the client. On an active client the
  editor no longer says "save it as a draft" or "ready to activate". Browser test `e2e/local/coverage/client-edit.spec.ts`.

### I68 — The campaign page is the one page (30 Sep, Edward; ADR-0132 proposed; branch `campaign-one-page`)

Edward, 30 Sep: clicking a task on the Team page "opens only the task… there should be one page… when actions are completed they return
the user to… whichever page they were originally on". Mockups `Claude outputs/mocks/one-page-*.html`; decisions recorded in ADR-0132.

- [x] `I68.1` ADR-0132 accepted (Edward, 30 Sep).
- [x] `I68.2` The piece's side panel edits every deliverable field (name, type, quantity, owner, due date, channel and languages,
  workstream and phase, brief lines), and opens from every tab; switching tabs keeps it open on the same piece.
- [x] `I68.3` The panel's task list: Task · Assignee (read only) · Due · Status, edit and cancel/delete; a task is added with its name and
  due date only, unassigned; the task-list approval and "Close the piece" in the panel.
- [x] `I68.4` A type change is direct, asked first, for anyone who may edit the piece: the old type's open tasks cancelled and bookings
  freed, assignees told, finished work kept, the new list generated; the owner told who changed it (amends ADR-0110 — the change request
  stays for the client). Migration + pgTAP.
- [x] `I68.5` A task the owner adds counts as approved; anyone else's waits for the owner; a type change follows the same rule (amends
  ADR-0100). Migration + pgTAP.
- [x] `I68.6` "Edit the brief" and "+ Add a deliverable" on the campaign page's header; "Promote to a campaign" on a single job's header.
- [x] `I68.7` A single job uses the campaign layout: the six tabs, greyed with a tip when empty (Season map and Timeline with nothing
  dated; Board and Where is everything with one deliverable); Brief and Grid always on.
- [x] `I68.8` A task clicked on the Team page, the Schedule or a dashboard opens the campaign page with the piece open and the task marked,
  for those who may edit the piece; the maker keeps the task page. Notifications about a piece or its task list open the piece.
- [x] `I68.9` Back names and returns to where you came from (Team same week and tab, My Work, Schedule same days and view, a dashboard,
  Campaigns with its filters), top and foot; with no page before it, "← Campaigns".
- [x] `I68.10` The Deliverables page stays a list; its window is retired; every "Open in Deliverables" link and Needs-you card opens the
  campaign page with the piece's panel open.
- [x] `I68.11` Found by the browser specs (30 Sep): **moving a piece's phase in the panel neither moves its due date nor asks** — the
  Edit dialog did (I57.36, `EditPieceDialog.tsx:157`); `PiecePanel` calls `move_deliverable_to_phase` alone.
- [x] `I68.12` **The panel's direct due-date change gives no ADR-0093 warning** (tight / impossible / after go-live) and records only
  `deadline_changed`, not `due_date_override` with its severity (migration `20260930122000`).
- [x] `I68.13` **A bare `/deliverables?open=<id>` link still opens the retired window** — the forward (`DeliverablesPage.tsx:227`) needs
  `&campaign=`; it must look the campaign up.
- [x] `I68.14` **"Waiting on someone outside" and the deliverable's chat live only in the retired window** (`ExternalInputs`,
  DeliverablesPage) — they move into the panel.
- [x] `I68.15` Pre-existing, since 27 Sep (ADR-0116): the section D walk's fixture leaves "Motion bumper" outside every workstream, and
  `campaign-phases-guide` drives the removed `wizard-phases-toggle`. Bring both to ADR-0116.
- [x] `I68.16` **A promoted single job has no workstream, so "Propose more" adds nothing** (found by the job-to-campaign walk, 30 Sep;
  since ADR-0116, 27 Sep, not I68): the walk's chapter E stops in both languages. Should promotion create a workstream? — Edward.
  **Built 30 Sep (Edward, A):** migration `20260930130000` — promotion puts the job's ungrouped live pieces into one workstream
  per department (named after it, owned by the first piece's owner when a lead, letters by the existing rule, codes kept);
  already-promoted campaigns backfilled once; pgTAP 205 (11/11). ADR-0116 addendum.
- [ ] `I68.17` **One k-my-work test failed once in the full local run** and passed alone and on a rerun of the file (27/27) — not traced.
- [x] `I68.18` **Back reads only "Back" after a single job is created** — the page it came from (the new-request form) has no
  label in `src/lib/navigation/origin.ts`, so the button cannot name it (seen in the job-to-campaign walk, shot 004).
  **Fixed 1 Oct:** a creation form (`/campaigns/new`, `/campaigns/new-job`, `/clients/new`) is never a Back target — Back skips it
  to the page the form was opened from, else the fallback ("Back to Campaigns"). `origin.test.ts`.

### I67 — Fixes from Edward's 30 Sep list (branch `fixes-30-sep`)

- [ ] `I67.1` **Single-job tasks still show the deliverable's quantity** — "Static Post x 3 Translation" (Edward, 30 Sep: "A fix was
  already implemented for this and it is not working on single jobs … the qty defined for deliverable should not be
  included in the job title"). Cause: the task titles are clean (I57.48); a single job stores the count IN its
  deliverable's NAME (`deliverableNameFor`, `intake/lib/single-job.ts:121`), and every screen printing a task beside its
  piece (Team timeline `taskLabel`, My Work, the task page, the booking dialog, the Team Member dashboard) prints
  "Static Post ×3". Fix: a single job's deliverable is named without the count, as a campaign piece is; existing ones
  renamed once (migration); the count still shows where deliverables are listed ("× 3").
- [ ] `I67.2` **Deleting a task leaves My Work and the Schedule stale until a manual refresh** (Edward, 30 Sep: "all related
  views should be reflected in real time"). Cause: `useRemoveSubTask` refreshes only `['deliverables']`/`['requirements']`;
  cancel / assign / re-open refresh `['bookings']`, a key no query uses; nothing pushes another person's change (the
  Schedule and Team poll every 20 s). Fix: one shared refresh for every task change, and a live signal from the database
  (a tenant-private broadcast on task and booking changes) that runs it on every open screen.
- [ ] `I67.3` **The Team timeline's bars are coloured by status, and the key is the status** (Edward, 30 Sep, A). Was: by
  workstream, the key listing workstreams (Figma L3 `1585:218` draws Design · Motion · Review · Blocked · Unassigned).
  Now: Not started · In progress · In review · Changes requested · Blocked · Unassigned, in L3c's (`1675:826`) pill
  colours; late keeps its red edge; the workstream select stays as a filter.
- [ ] `I67.4` **One set of status words, one rule for a deliverable's status, and its progress on hover** (Edward, 30 Sep).
  Words, one at a time: a finished task **Done** (A, as ADR-0077); a finished deliverable **Approved** (A — not
  "Complete", not "Finished"); work nobody is on **Unassigned** (A — not "Nobody on it"); work sent back **Changes
  requested** (A — not "Changes to fix"); a piece held up **Blocked** (A — "Waiting" retired on the campaign board,
  timeline and season map). Capitals stay where the frames draw them; only the words change. **A deliverable's word follows its LEAST
  advanced open task** (A, after the mock `Claude outputs/mocks/deliverable-progress.html`): Not started until a task
  starts, In progress until every open task is in review, In review only then — was "the most advanced task wins", in
  four copies (`work-phase.ts`, `where-is-everything.ts`, `dashboard/lib/figures.ts` ×2, `dashboard/views.tsx`), now one
  rule. **A progress bar and a hover card with the numbers** ("2 done · 1 in review · 3 in progress · 2 not started — 2 of
  8 done"; Edward, 30 Sep, after the first cut: one line per status, "2 of 8 – Done", nothing said twice) wherever a
  deliverable is a row or card (A): the Deliverables page and Pipeline, the campaign page (list,
  board, timeline, Where is everything, piece and workstream drawers, Edit piece), the dashboards' rows, Team's By piece,
  the client page; the season map's squares get the card only; the dashboards' counts stay numbers. Arabic: one form
  each for delivered and blocked, to be checked by a native speaker (I18.8).
- [ ] `I67.5` **On the local stack, Realtime refuses the browser's key** — found building I67.2: the local Realtime rejects
  the new-style publishable key as a malformed token, so neither the work channel (ADR-0130) nor the existing
  notifications channel joins in a local browser. The two-client proof used the local anon key. Traced 30 Sep: the local
  Realtime (v2.124.4, CLI 2.114.0) logs `MalformedJWT: The token provided is not a valid JWT` every 2 s — the browser
  opens the socket with the `sb_publishable_…` key, which is not a JWT. The hosted gateway swaps that key for a JWT; the
  local one, by this evidence, does not. Local-only; nothing live is affected. **Production confirmed working (Edward, 1 Oct).**
- [x] `I67.6` **The progress hover card opens by itself when a piece's side panel opens** (found 30 Sep, in PR #57's change): the panel
  moves keyboard focus to the status pill, the card opens on focus and covers the piece's name. Seen on the campaign page's panel.
- [x] `I67.7` **The Schedule's day headers read "27 Sept"** — `DayGrid.tsx:199` builds its own `month: 'short'` format (en-GB gives "Sept"),
  missed by I66.8's "Sep, never Sept" (ADR-0127).
- [x] `I67.8` **The Schedule's hover card shows the task's status and its deliverable's breakdown** (Edward, 30 Sep, B): a "Status:"
  line in the agreed words, and the "x of y – status" lines under it. Today it shows only the booking's state (Soft hold / Provisional /
  Confirmed).
- [x] `I67.9` **"Promote to a campaign" is missing from a single job's own page** — only on the Campaigns list's ⋯ menu; never on
  `CampaignPage.tsx`. Folded into I68.6.
- [x] `I67.10` **A task list's bell notices stay after someone approves it** (Edward, 30 Sep: yes, log it). The Needs-you card goes for
  everyone the moment one person approves (`my_pending_approvals` reads `tasks_approved_at`), but the bell's notices are one row
  per person with only `read_at` — the owner's "approve the task list" notice and the ADR-0119 escalations to Traffic and the
  account manager stay unread. Clear or mark them done for everyone when the list is approved.
  **Built 1 Oct (Edward chose B — removed, not marked read; ADR-0119 addendum accepted):** migration `20261001100000` — approving
  a list deletes, for every recipient, the notices on that deliverable that asked for it (the task_list escalation, the owner's
  added / reassigned / type-changed asks, a single job's approval notice) and the owner's campaign-level approval notice once
  none of their pieces on it still waits; a deleted notice broadcasts `notification_removed` so an open bell reloads. pgTAP 208.

### I66 — Full names, not nicknames, everywhere (29 Sep, Edward)

- [x] `I66.1` Defect, seen on production: **several places named a person by their nickname.** I59.55/I59.58 (27 Sep) fixed
  the Team page only; each screen picks its own label, and six still wrote `nickname ?? name` — the booking dialog's
  headline and its "who is told" line, the Schedule's move dialog, the "who has room" list (Schedule and Team drag), and
  the new dashboards' load rows and "over the ceiling" captions (28 Sep, after the Team fix). Rule agreed (Edward, 29 Sep):
  **the full name wherever a person is named; the nickname only as the small tag beside it** (Schedule rows, Directory,
  Resources admin — ADR-0011). All six now read the name; the captions show the full name, not its first word.
  `src/test/full-names.test.ts` refuses a nickname standing in for a name anywhere in `src/` (proved failing on the old code).
- [x] `I66.2` **The approval exceptions: Unfinished briefs, Briefs awaiting approval, Task lists not approved** (Edward,
  29 Sep). Answers, one at a time: an unfinished brief is a draft I started (A); a brief not yet approved is its own
  figure; **My Work counts only what waits on me** — my drafts, and the briefs and task lists `my_pending_approvals`
  gives me (the brief figures only for `projects:manage`, the grant the database asks); **the dashboards count over
  the view's own reach** (member: me; team/department: its people; account manager: their accounts; director and
  company views: everything; the client filter applies), each card naming who the items wait on ("Omar Hadi 2 ·
  Reem Saleh 1", the viewer as "you") — a draft waits on who started it, a brief on its account manager (ADR-0048
  d.9), a task list on its piece's owner. **A card opens the campaigns list filtered** to what it counted:
  `?status=draft` (the drafts only), `?status=pending_approval`, `?alert=taskLists` (new alert, also in the Alerts
  select), `&scope=mine` for the member and account-manager views. Task-list rule shared with the list's badge
  (`awaitsTaskListApproval`, `lib/campaigns/pulse.ts`); reach rule `dashboard/lib/approvals.ts`. Checked in the
  browser on the local stack as account manager, department lead, Traffic and a team member.
- [x] `I66.3` **A piece with no tasks has no task list to approve — its owner is asked to define the tasks** (Edward,
  29 Sep: "how can you include them in the count when there is nothing to count?" … the owner "should still see their
  notification … if no tasks have been created, then you need to define the tasks"). Found checking I66.2: the Creative
  lead's My Work counted 54 lists, the dashboard 31; the 23 were pieces with no tasks at all. Where they come from: a
  piece with NO deliverable type has no workflow, so no task is generated (ADR-0051 d.7 allows it — the single-job form
  says the lead breaks the work down by hand); also a type whose workflow has no steps (none today), or every task
  deleted. The 26 Sep live backup has NONE (173 untyped pieces, every one given tasks by hand); the local 23 were browser
  -test jobs made untyped, then typed by `scripts/db/demo-dashboards.sql` with triggers paused. Built: migration
  `20260929120000` — `my_pending_approvals` gives a piece with no live task as `task_list_undefined` (same people, same
  clock), so every "Task lists not approved" figure counts `task_list` only; `approve_campaign`, `add_campaign_deliverable`
  and the owner-change trigger record `no_tasks` in the owner's notice. The Needs you card reads "No tasks have been
  created for X — define the tasks" with **Define tasks**; the bell and the mail (`notify-email`, EN+AR) say the same.
  pgTAP 195 (9/9); 190's fixture given a task each. Clean-database run: 193 files, 2,608 tests pass. Checked in the
  browser as the Creative lead: 31 lists, 23 "Tasks to define" cards. **`notify-email` changed — to deploy.**
- [x] `I66.5` **Two defects in I66.2/I66.3, found by Edward previewing locally (29 Sep).** (a) Traffic's "Task lists not
  approved" read 42 and its caption named 32 — it named only the top two people, so Noor Kanaan's 10 dropped off. Now up
  to three people by name, past that the first two and "N others" with what they hold, "no owner" for an item nobody
  holds; the whole list on hover; the three approval captions wrap rather than cut a full name off. (b) The My Work
  task-list card said "Task list" and the piece's name, not what was required — it now reads "Review and approve the
  task list for X", as the new "No tasks have been created for X — define the tasks" does.
- [x] `I66.6` **"Task lists not approved" opens the task lists themselves** (Edward, 29 Sep: "should return a filtered
  view… not all campaigns"; chose B — one row per list, not the campaigns holding them). `/deliverables/task-lists`
  (behind `project_tasks:manage`, as Deliverables): the piece, campaign, client, who it waits on, how long it has
  waited, Open → `/deliverables?open=`; oldest first; `?client=` from the Dashboard's filter. The same rows as the card by
  the same rule (`approvalFigures`) over the same reach — `reachFor(view)` is now the one mapping the Dashboard views
  and this list use (`useApprovalReach`). How long it has waited is the database's one clock (ADR-0119 d.3), read
  through the new view `task_list_waiting` (migration `20260929130000`, security_invoker; pgTAP 196, 5/5) — not a
  second copy of the rule. Browser test in `e2e/local/coverage/the-second-gate.spec.ts` (card count = rows, each
  names its owner, Open opens the piece) — it also clears `db-stat-*` from the coverage baseline. Checked as the
  Creative lead: card 31, list 31. The campaigns list keeps its "Task lists to approve" alert.
- [x] `I66.4` **The escalation of a piece with no tasks said its task list "has waited for approval"** (found building
  I66.3; Edward, 29 Sep: "fix escalations"). Migration `20260929140000`: `app.escalation_due`'s task_list rung marks
  `no_tasks` (no live task) in its detail — same rung, same clock (ADR-0119 d.3); the sweep copies it into the notice.
  Needs you: "Escalated: X has had no tasks defined for 24h"; the mail (EN+AR): "…has had no tasks defined for … find out
  from its owner what is holding it, or define the tasks." pgTAP 197 (3/3).
- [x] `I66.7` **Everyone lands on My Work; anyone without My Work lands on the Dashboard** (Edward, 29 Sep). Was per
  role (`roles.default_route`): Account Director → Campaigns, Account Manager → Schedule, leads → Team, C-level and
  admins → `/admin`. **Edward chose B: keep the per-role setting, set every role to it** (not one fixed rule). Migration
  `20260929150000`: every role, every tenant → `/my-work` where it holds My Work (my_tasks:view or my_calendar:view),
  else `/dashboard` (CEO, COO, CFO); the portal keeps `/portal`; `app.seed_tenant_roles` and `app.seed_account_director`
  reproduced with the new routes. `app/landing.ts`: anyone whose landing is My Work but who cannot open it lands on the
  Dashboard. The Roles page's landing list now offers My Work, Dashboard, Campaigns, Schedule, Team, Portal (`/admin`
  dropped — it opens the Dashboard). pgTAP 198 (4/4); browser L5 (each role lands on its route) passes.
- [x] `I66.13` **The deliverable window a card opens offers the task-list approval and Close** (Edward, 29 Sep: "on the
  modal that opens, there is no option to close the deliverable and there is no option to approve the task list"). The
  Needs-you cards (Review list, Define tasks, Tasks cancelled) open `/deliverables?open=` — `DeliverableDetail` showed the
  approval on single jobs only (campaign pieces' approval lived on the campaign page, ADR-0100) and had no Close at all
  (it was on the list's rows and in Edit piece). Now: the approval on any campaign or single-job piece with a task that is
  not cancelled (or to say who approved it); "Close this deliverable" wherever the archive move is allowed, asked first
  with what it calls off (the Edit piece wording). Unit tests in DeliverablesPage.test; browser test
  `e2e/local/coverage/deliverable-window.spec.ts` (approve offered, Close closes — the state reads archived).
- [x] `I66.12` **Error reports say what happened; a job already sent is not re-saved as a draft** (Edward, 29 Sep, on
  Mais Abdulkarim's report "The request could not be saved… Code: 23514, Cause: campaign_not_draft": "this message is
  vague… how am I supposed to know what this error was?"; "make both fixes"). Traced on production: her single job
  "Harmony Oct Content" was sent at 11:16 Iraq time and waits for its account manager — the CLIENT's, Mais herself — whose
  role is Team Member (reach self), so approve_campaign's reach check refuses her though she holds projects:manage
  personally; reopened ("Continue" on the card), the flow's Next re-saved it as a draft and the database refused
  (`campaign_not_draft`), shown as the generic save failure. (1) **Reports:** `lib/errors/explain.ts` says what a code or
  cause means in words (campaign_not_draft, 23505, 23514, 42501, P0002, sign-in expired, network…); every report
  carries the page (a link, when it is the app's own address) and the screen's own context — the single job sends its
  name, step and status — and the email reads When (Iraq time) · Where · Page · What they were doing · What they saw ·
  What it means · Code · Technical cause (`report-error` changed — to deploy). (2) **A sent job:** reopened, it stays on
  review with "This job has already been sent for approval — it is waiting for <account manager>", no Back, no
  autosave; a draft save refused mid-way (another tab) says so instead of the generic failure, not reportable.
  Checked: a report sent through the local function and read in Mailpit. ~~Open for Edward: Mais's role~~ **Answered 30 Sep: Edward approved "Harmony Oct Content" himself and updated her
  permissions.**
- [x] `I66.11` **A deliverable whose every task was cancelled asks its owner to add a task or close it** (Edward, 29 Sep:
  "when a deliverable only has one task and the task is cancelled… it gets stuck in limbo"; chose B over closing it
  automatically). The ADR-0118 addendum (I65.4) closes a piece whose last open task goes only when one task was approved,
  so work all called off stayed In progress with nothing to do — three on production (Sunset orange: Packaging,
  City Stamp design, Sunset orange Logo); their owners were told "define the tasks" (unapproved list) or nothing
  (approved list). Migration `20260929160000`: `my_pending_approvals` gives the OWNER a `tasks_all_cancelled` card —
  "Every task on X was cancelled — add a task, or close the deliverable" — since the last cancellation (the task-list
  card leaves these out); `escalation_due` escalates it on the task_list rung's hours to its recipients, from the last
  cancellation (`all_cancelled`; the unapproved-list rung leaves it out). Needs you and the mail (EN+AR) word the
  escalation. pgTAP 199 (6/6); 195's third case now this card. Clean-database run: 197 files, 2,626 tests. Checked in the
  browser on the Creative lead's My Work.
- [x] `I66.10` **Ad-hoc work is switched off** (Edward, 29 Sep: "Adhoc tasks is still available, we need to remove this
  option"). The Schedule's booking dialog offered "Project task / Ad-hoc task" on a person (I48.5 had brought it back on
  13 Sep); ad-hoc made a deliverable owned by the ASSIGNEE, which the lead-owner rule skips — 67 team-member-owned ad-hoc
  deliverables on production, the newest 28 Sep. The choice is removed: on a person only a task from a project; a room
  or equipment keeps its note ("Note", was "Ad-hoc task description"). Existing ad-hoc deliverables untouched (the
  Deliverables page's Ad-hoc tab). `create_adhoc_deliverable` is still in the database, reachable by nothing on screen.
  Browser specs brought over (schedule-page, team-view L7, i-scheduling I3/I6, section M's setup) and run on a reset
  local database — all pass.
- [x] `I66.9` **Every owner list offers only the leads of the deliverable's own department** (Edward, 29 Sep: "even when
  a deliverable is assigned to creative it lists department and team leads for non-creative team members… i thought we
  agreed to filter the options"; chose A over "own department first, a switch for the others"). What had been agreed
  was the Single job only (I54.30); everywhere else a department- or team-scoped viewer saw their department and
  Traffic, account managers and admins saw EVERY lead — because since ADR-0102 a piece's department follows its
  owner, so the owner list doubled as the way to move a piece. Built: `src/lib/people/leads-of-department.ts` (the
  department's leads; every lead only where there is no department yet or it has no lead), used by Edit piece, the
  Deliverables page's owner control, Add a deliverable and Propose more (the chosen workstream's department), the
  wizard's piece dialog (the piece's workstream) and workstream owners, and the campaign page's workstream panel (the
  chosen department). Moving a piece to another department is its workstream. Tests brought to the rule
  (EditPieceDialog, DeliverablesPage, BriefWizard). Checked in the browser: Traffic editing a Creative piece is offered
  the four Creative leads only. Found alongside: 67 ad-hoc deliverables owned by team members (the Schedule's ad-hoc
  path makes the assignee the owner, and the lead-owner rule skips ad-hoc) and one campaign piece set before the rule
  (Borderless Card, 4 Sep) — Edward: ad-hoc work is being switched off; not changed.
- [x] `I66.8` **Every date shown and entered reads "Fri, 9 Oct"; a mistyped date asks to be fixed, never crashes**
  (Edward, 29 Sep, with a production crash: "RangeError: Invalid time value at Date.toISOString"). Cause: the Single job's
  due-date box — Chrome's year box takes five digits, `20266-10-09` is a valid HTML date and not a real one, and the
  day strip (`intake/lib/lead-time.ts`) did date arithmetic on it on every keystroke; no error boundary, so the page
  went. The same weakness sat in all 39 date boxes. Edward's answers, one at a time: **A** keep the browser's calendar
  box, show the day beside it, catch a mistyped date; **A** the year only when it is not this year; Arabic **A**, the
  pan-Arab form with Western digits ("الجمعة، 9 أكتوبر") — a client and staff in Egypt, staff in Dubai. Built:
  `lib/time/iraq.ts` — every formatter reads "Fri, 9 Oct" / "Fri, 9 Oct, 15:00" / "…2027" (Sep, never Sept),
  `formatCalendarDay` for YYYY-MM-DD days, `stampFormatter`/`dayFormatter` for screens that built their own;
  `lib/time/real-day.ts` (`isRealDay`, 2000–2099, the day must exist); `components/DateField.tsx` replaces all 37
  `type="date"` boxes (the day in words beside, "That isn't a date — pick it from the calendar." under a wrong one,
  only a real day or '' passed on, what was typed kept); the one date-and-time box guarded the same way; the day strip
  refuses an unreal day. ~25 screens that formatted their own dates or printed raw YYYY-MM-DD moved to the shared words;
  the emails follow (they import the same file). Stamps (inbox, review comments, audit, feedback) now read in Iraq
  time, as ADR-0076 asks, not the viewer's computer clock. **Left as they were:** weekday-only column heads and lists
  ("Sun", "Mon") and the compact ranges ("26 Sep – 2 Oct") of the season map and phase headers — **they stay (Edward, 30 Sep; ADR-0127 d.5).** Checked in the browser:
  the five-digit year on the Single job reproduced — message shown, page stays, no error; Arabic My Work reads
  "السبت، 10 أكتوبر", no Eastern digits, no Iraqi month names.

- [x] `I66.14` **CI's dependency audit failed on a docs-only push (30 Sep)** — new advisories against `undici` 8.9.0
  (one high), pulled in by `jsdom` for the unit tests only, not shipped. `npm audit fix` (Edward) moved it to 8.11.2 in
  `package-lock.json`; the audit gate passes at `high`, unit 3,580 and the build pass.
- [ ] `I66.15` **`vitest` 4.1.10 carries a moderate advisory** (GHSA-82fw-gwwq-j7x9, test tooling only). The fix is
  `vitest` 5 — a major upgrade outside `^4.1.10`, so `npm audit fix` leaves it. Does not fail CI (the gate is `high`).

### I65 — Found by the 28 Sep regression check; the browser tests brought to the product (Edward, 28 Sep: "fix any failing tests")

The 35 failures of the 28 Sep full `e2e:local` run, each traced. Two were product defects (fixed), two are open
product gaps found while fixing them; the rest were specs written before a decision since taken.

- [x] `I65.1` Defect: **the Reinstate task dialog's buttons were wider than the dialog.** With Inter loaded (since
  a3f34e4, on main), Cancel · Reinstate unassigned · Reinstate and assign did not fit the 440px dialog and Cancel
  hung off its start edge, onto the backdrop. Not from role-dashboards: the baseline run passed only because its
  copy could not load the font. Fixed app-wide: `.dialog-actions` wraps (`index.css`) — no change where the
  buttons fit. `deliverables-page.spec.ts:220` passes.
- [x] `I65.2` Defect: **Propose more on a campaign with no workstream says the wrong thing.** The dialog's error
  reads "Every row needs a deliverable, a label, an owner and a due date" when every row is filled and the only gap
  is the workstream (a promoted job has none). The hint above the table names it; the error should too.
  **Fixed 29 Sep:** rows complete and only the workstream missing → "Choose the workstream these pieces go into, above
  the table.", or, with none on the campaign, "This campaign has no workstream yet — make one under Workstreams, then add
  the pieces." (EN+AR).
- [x] `I65.3` Defect: **the wizard's last phase could not be removed.** ADR-0116 d.1 says it can (the campaign then
  has none) and the phase dialog offered Remove, but `removePhase` still refused the only phase — in silence.
  The guard is gone (`BriefWizard.tsx`).
- [x] `I65.4` Defect: **a deliverable stayed In progress when its last open tasks were cancelled after the others
  were approved.** ADR-0118 closed it only on a task APPROVAL; with no Approve button (d.2) the piece was stuck with
  every task settled. Edward, 28 Sep — "A": a cancel or a delete runs the same check (ADR-0118 addendum).
  Migration `20260928160000` (`app.tg_close_settled_deliverable`, security definer, pinned search_path): closes
  only In progress, only with no task open and at least one approved. pgTAP 194 (8) and 189 brought to it;
  `verify.sh` 192 files / 2,599 tests pass. K2/K4 walks that order again — approve, then cancel the rest — and the
  piece closes; before the migration the same walk failed on In progress.
- [x] `I65.6` Defect, from I62 on this branch: **the rules' Do / Don't badges showed their raw keys**
  (`CLIENTS.FORM.RULEDO`) on the task's review, the task-list approval and the single job's brief and review —
  the old client form's strings went with it. The four now read `clients.rules.do` / `dont`, the client pages'
  own words (Arabic مسموح / ممنوع, was افعل / لا تفعل). Every literal text key in `src` checked against both
  languages: none other missing.
- [ ] `I65.7` **I4's refusal step failed once in three full `e2e:local` runs** (28 Sep, after the I65.4 migration;
  the run before it passed). After the owner forwarded the SECOND request — the helper saw it reach the account
  manager's stage — `/deliverables?task=` showed no decision for it (`subtask-extension-…-decide-refuse` missing;
  the row read the first extension as granted). Passes alone (twice) and in the whole retest folder in order
  (106/106). Not the cancel/delete roll-up: no task is cancelled in I4. Cause not yet traced — to watch.
- [x] `I65.5` The specs brought to the product, each to the decision it predates (Edward, 28 Sep):
  - client screens, ADR-0123 — `campaign-approval` (the manager changed on Basics), `review-rules-and-chime` (the
    director registers and activates, rules on step 4), `l-cross-cutting` L3a (the client form is a page, not a
    dialog, so it left the dialog list), `b-single-job-request` B2 ("who asked" suggests the client's people);
  - ADR-0116 (no switches, every piece in a workstream) — `campaign-phases`, `campaign-wizard`, `wizard-dialogs`
    (the last phase can go; Move offers no "out of all"), `workstreams`, `where-is-everything` (a piece per group);
  - ADR-0118 (approved only when every task is) — `reopen` (every task settled), `k-my-work` K2/K4;
  - ADR-0121 (a re-opened task goes back to be assigned) — `reopen`;
  - I59.45 (every link opens where the action is) — `notification-mails`, `notifications`, `i-scheduling` I4;
  - I59.47 (one notice after the date question) and I63.8 (weeks without phases) — `campaign-phases`;
  - I59.57 (leads edit the task on its page) — `task-page` M2; I59.59 (unassigned work shows once its list is
    approved) — `team-view`; I54.30 ("Department lead") — B8; the owner's full task table — `g-full-campaign` G4;
  - dates that collided with the fixture on some weekdays — `change-request` (30/31 days out), `campaign-phases`
    (Week 1 three weeks long).
  `check:e2e-coverage`: 77 known, 0 new (four client controls now covered).

### I64 — The local stack on real data (28 Sep, Edward) — ON HOLD

Edward, 28 Sep: *"I would prefer to have the real data, but updated to reflect the system as it is now which would mean
cleaning up the existing data."* Today the local database is an invented tenant (`supabase/seed.sql`, I43) plus the demo
scripts (`scripts/db/demo-dashboards.sql`, `demo-clients.sql`) — not live. Live backups: `<BACKUP_DIR>`
(latest 26 Sep). Held by Edward until he says go.

- [ ] `I64.1` Load a live backup into the local stack, and clean the data to the system as it is now (the rows written
  before later migrations — e.g. pieces without IDs, types or workstreams). The steps and what changes, for Edward
  before anything runs; live client data on the local machine is his call.

### I63 — The campaign page to the Figma style: section D (28 Sep, Edward) — built

Edward, 28 Sep: *"Campaign/<id> does not match the style of the figma file. This is flow D… starting from CG-01, the
title, the badges and the tab bar with its background. also all of the filters for each tab, and the design of each
row.. with outlines as per the figma files.... the season map is also missing from the campaign views"*. Frames:
section D (`1570:59`) — CG-01 Grid `1555:2`, CG-02 Season map `1577:2`, CG-03 Where is everything `1652:936`, CG-05
Board `1653:543`, CG-06 Timeline `1653:851`, CG-07 Brief `1711:522`. Built on `role-dashboards`.

Found 28 Sep: the Season map tab is hidden on a campaign without phases (I57 answer 9), and no campaign in the local
data has phases — so it never shows.

- [x] `I63.1` Header: the title, the chips (client · brand, where the campaign is), the one summary line. Edward,
  28 Sep (A): the account manager is the line's "… approves" with the change pencil after the name; "started by /
  last changed" (I51.1) moves into an (i) tip beside the title.
- [x] `I63.2` The tab rail on its grey ground, as drawn.
- [x] `I63.3` Every tab's filters as the frames' pill buttons (a chosen one purple).
- [x] `I63.4` Rows as the frames' outlined cards — Grid, Where is everything (a problem row outlined red), Board, Timeline.
- [x] `I63.5` The Season map on every campaign (Edward, 28 Sep: B — amends I57 answer 9): phase columns when the
  campaign has phases, week columns (Pre-launch, Week 1 … Post) when it has none, as CG-02 is drawn.
- [x] `I63.7` Defect (Edward, 28 Sep: "the piece id is missing"): the demo data (`scripts/db/demo-dashboards.sql`, I61)
  wrote its pieces with the triggers paused, so the ID stamp (I56.9) never ran — 85 of 90 pieces had no ID, and none
  had a type, channel, format or language. The script now issues each ID with `app.next_deliverable_code` and gives
  each piece a catalogue type matched to its name, that type's channel and format, and Arabic. App-made pieces were
  never affected.
- [x] `I63.8` Defect (Edward, 28 Sep: "the phase filter is missing"): Grid and Where is everything showed it only on a
  campaign with phases. It now lists the campaign's phases, or its weeks without phases — the season map's own
  periods (`periodColumns` / `columnKeyOf`), so the filter and the map agree. Where opens on this week, as CG-03.
- [x] `I63.6` Walked on the local stack beside each frame; the review report —
  `Claude outputs/reports/2026-09-28-campaign-page/REPORT-vs-figma.html`.

### I62 — Client registration: Figma section J (28 Sep, Edward) — ADR-0123 accepted

Edward, 28 Sep: *"fix the client registration. as per J in figma… exactly as per the layout in figma."* Figma section
`J · CLIENT REGISTRATION` (node `1614:413`): CL-v3-01 Basics, 02 Brands, 03 People, 04 Dos and don'ts, 05 How we work,
06 Review and activate, CV-01 Clients, CV-02 Client page. Built on `role-dashboards` (Edward: "use the last branch").

**Answered 28 Sep, one at a time:** (1) anyone with `clients:manage` starts a draft; only the Account Director and the
Power Admin activate — A. (2) the client's country drives the working-day arithmetic of its work — B. (3) the people at
the client are records, and a job's "who asked" / "sign-off from" picks from them — A. (4) client rules carry their
languages and lock on activation — A. (5) the profile fields the frames leave out are no longer asked; saved values are
kept; **the report must list every removed field** — A.

- [x] `I62.1` **ADR-0123** — accepted 28 Sep.
- [x] `I62.2` Schema: client status (draft / active, who activated, when), `clients:approve`, country + a countries
  list with working weeks, brand short name, client contacts, rule languages; existing clients made active, Iraq, rules
  in every language. RLS + audit in the same migration; pgTAP. — `20260928120000`; `20260928140000` adds "ask the
  director" (who asked, when; a `client_activation_requested` notification to every `clients:approve` holder). pgTAP 193,
  18 tests; clean-database run 191 files / 2,591 tests pass.
- [x] `I62.3` Drafts are never offered: every client picker filters them; a campaign or job for a draft is refused in
  the database. — the campaign / single-job pickers and the library; the audit filter keeps drafts (it names history).
- [x] `I62.4` The client's country is the calendar for its work's deadline arithmetic (ADR-0123 d.3) — every place
  named in the ADR, unit-tested per country. — `lib/calendar/client-calendar.ts` (the country's week, the office's
  closures); `app.working_hours_between` is on no live path (ADR-0108), so it is left.
- [x] `I62.5` The six-step registration (CL-v3-01 – 06), exactly the frames: stepper, profile meter, saved as a draft,
  duplicate-name check, the director's Activate.
- [x] `I62.6` The clients list (CV-01) and the client page (CV-02); a single job opens with the client chosen (`?client=`).
- [x] `I62.7` A job's "who asked" and "record sign-off from" pick from the client's people. — suggestions (a typed
  name still accepted): the single job's "who asked" and the reduced-scope record's "who answered".
- [x] `I62.8` Client rules locked on activation: only the director edits them; campaigns add on top (I56.6).
- [x] `I62.9` The review report — each frame beside its build; **lists every profile field removed from the form**. —
  `Claude outputs/reports/2026-09-28-client-registration/REPORT-vs-figma.html`.
- [x] `I62.11` Defect (Edward, 28 Sep): the campaign page failed to load — "more than one relationship was found
  for 'clients' and 'user_profiles'". `20260928140000`/`…120000` gave `clients` two more links to people (activated_by,
  activation_requested_by), so the page's unnamed embed of the client's account manager became ambiguous. Named the
  link (`clients_account_manager_id_fkey`); it was the only such read in `src/` and `supabase/functions/`.
- [x] `I62.10` Browser tests for the client screens (`e2e/coverage-baseline.json` lists them) — owed; automated tests on
  hold (Edward, 27 Sep). The old client-form coverage test is skipped as replaced. **Done 1 Oct:**
  `e2e/local/coverage/client-screens.spec.ts` (5 tests) presses all 37 controls — registration, duplicate check, list,
  activation, the client's page — as Traffic / the director (may) and the department lead / a team member (may not);
  off the baseline.

### I61 — Role dashboards: Figma section H, the seven views of E2EV1.pen (28 Sep, Edward)

Edward, 28 Sep: *"todays focus is on Section H of figma… the E2Ev1.pen file maps out 6 different dashboard each
tailored to a specific role… the figma file is the desired layout, styling and color… The top bar is where the
exception reporting highlights should go and should be focused on problem areas that allow the user to drill down
where actions are required. Our first task is to map out the specific data for each role, one view missing is the
team member."* Roles: C-Level; Department Lead; Team Lead (Deputy Team Lead too); Traffic Manager; Power Admin;
Client Services (Account Director and Account Managers); and Team Member, from Figma's maker frame DB-M. The data map
(issues to highlight, drill-down targets, data status per role):
`(a private design artifact, not included)`. Figma section H is node `1592:2`.

- [x] `I61.0` **The data map for the seven views** — done 28 Sep (the artifact above). Content from the six `.pen`
  Health frames, shape from Figma H, data status from the code: Have / Build / New.
- [x] `I61.1` **ADR-0122 — the view is chosen by reach and permissions, never by role name** (Edward chose A,
  28 Sep). **Accepted 28 Sep.**
- [x] `I61.2` **Everyone signed in opens the Dashboard; each view shows only what the person already reaches**
  (Edward, 28 Sep: *"we are designing dashboards scoped to the user"*). ADR-0122 d.6. **Built 28 Sep:** `/dashboard`
  needs no grant; `/admin` sends on to it; the menu's Dashboard link goes there for everyone. Landing pages
  (`roles.default_route`) unchanged — settled after the dashboards (I48.16).
- [x] `I61.3` **Five numbers follow rules the system already has.** No question needed. **Built 28 Sep** (`lib/figures.ts`,
  unit-tested):
  - *On-time delivery*: a deliverable finished by its `due_at` (ADR-0075). Deliverables record no moment of delivery
    today (`delivered_at` exists only on `media_records`), so it is recorded when the state changes — **migration
    `20260928100000`: `deliverables.finished_at`**, stamped by a trigger when a piece first becomes approved or
    delivered, cleared on a re-open, backfilled from the audit trail; pgTAP 192 (6/6), 092 / 157 / 189 still pass.
    **Local only — Edward pushes.**
  - *Go-live in danger*: a campaign or job whose `go_live_at` falls this week, with a piece at risk or late.
  - *Awaiting client sign-off*: the temporary rule until the portal (STATE: approved and not given to the client).
  - *A clash*: a **room or piece of kit** booked twice at once. Corrected while building: a person's bookings may
    overlap by design (capacity engine §4.1), and a person booked past their week is the "over the ceiling" figure —
    counting their overlaps as clashes gave 254 on the local data.
  - *Unbooked time*: working hours minus booked hours (the capacity engine).
- [x] `I61.4` **The Power Admin's system rows — answered (Edward, 28 Sep: B).** The Power Admin view ships with
  the rows Maestro already records (escalation rules reaching nobody, users with no role, roles with no holders,
  personal grants, stale bookings). *"The important achievement for today is the rest of the users get dashboards."*
  **Built 28 Sep:** rules reaching nobody, people with no role, roles nobody holds, and late work. Personal grants and
  stale bookings are recorded but not yet counted — `I61.13`.
  The recording the four system rows need is **required later**: `I61.7`–`I61.10`.
- [x] `I61.5` **Department briefs in the .pen become task lists awaiting approval** (ADR-0100). Built: they arrive
  through Needs you ("Waiting on you", "What to touch today").
- [x] `I61.6` **Not blocked by `I59.63`:** the new dashboards count work with nobody on it by ADR-0118's ready-to-assign
  rule (the Team page's `readyToAssign`), not the view `unassigned_work_by_campaign`. I59.63 stays open for that view.
- [ ] `I61.7` **LATER (required, Edward 28 Sep): record failed and bounced notification emails** where the app can
  read them, then show them on the Power Admin view.
- [ ] `I61.8` **LATER (required): record server-function errors and timeouts** where the app can read them, then show
  them on the Power Admin view.
- [ ] `I61.9` **LATER (required): record releases** (migrations applied, last deploy) for the Power Admin view.
- [ ] `I61.10` **LATER (required): find stored files that no record points to** (the 16 known orphans, STATE) and
  show the count on the Power Admin view.
- [x] `I61.11` **The seven views, built 28 Sep** on `role-dashboards` (Figma H `1592:5` / `1592:118` / `1592:245`, method:
  the official `figma-design-to-code` skill). `src/features/dashboard/`: `RoleDashboardPage.tsx` (the header, the view
  picked by `lib/pick-view.ts`), `views.tsx` (Team Member, Team/Department Lead, Client Services, Traffic / C-Level /
  Power Admin), `components/blocks.tsx` (stat cards, panels, week bars, day bars, ring, bar list, What to touch today,
  My deliverables), `api/dashboard-data.ts`, the Figma icon assets in `assets/`. Needs you's sources are assembled once
  in `deliverables/api/use-needs-you-items.ts`, shared by My Work and the Dashboard. Pulse pieces carry their id, name,
  round and finish time. 21 colour tokens in `index.css` **and `E2EV1.pen`** (`--chart-*`, `--trend-*`, `--tint-*`,
  `--db-ground`) — **not yet in Figma** (Edward's seat is view-only there). EN + AR, every Arabic plural form.
  **Checked 28 Sep on the local stack:** every role opened as its own login (admin, traffic, ceo, ad, am, lead, tl,
  deputy, maker) — right view, no console errors, no sideways scroll; Arabic (RTL) for three, 400px for two; unit
  3,474 / 215 files; build clean; lint no new warnings. The old Overview (`DashboardPage.tsx` and its panels) is no
  longer routed.
- [x] `I61.15` **Round 2 — the views brought to the Figma frames (Edward, 28 Sep: "you did not use the actual colors in the
  figma frames … did not include sufficient data … use human readable names").** No outlines of my own on the cards; the
  frames' page ground, hairlines, labels, chips and table header (`--db-canvas`, `--db-soft`, `--db-label`); the bands
  joining the weekly bars; every chip working (This week ⌄, Filter by client, Sort, All clients ⌄, Live ⌄, All ⌄); the
  frames' readings — deliveries by outcome (on time / late / in review / still open), Busiest day (people booked a full
  day), Load by person on the frame's scale with its reason, Rounds used "1 of 2", the table's client and progress
  columns. `lib/figures.ts` gains `dueOutcomes`, `peopleFullPerDay`, `hoursPerDay`, `loadTone`, `campaignTone`
  (unit-tested). **Demo data, local only: `scripts/db/demo-dashboards.sql`** — the Figma story's people and campaigns,
  eight weeks of work, every assigned task booked for its own hours, time logged on work in progress; refuses to run
  without the dev tenant. The risk engine, run on Inas's pieces, flags three, each traced. Report:
  `Claude outputs/reports/2026-09-28-dashboards/REPORT-vs-figma.html` (each frame beside its build, what still differs
  and why). Unit 3,478; build clean.
- [x] `I61.16` Defect (Edward, 28 Sep: "C-level dashboard does not click through to anything… no drill down"):
  ADR-0122's "C-Level, read-only" was built as NO links. Read-only is what the C-level may change, not where they
  may look (d.4: every figure opens where it comes from). Each card and row now links when the viewer may open that
  page: campaigns (`projects:view`), a department's load (`team:view` — the CFO has none, so those rows stay
  plain); a client's risk row opens its campaign with most at risk; the pressure card opens that department.
  Walked as the CEO: 10 links, all land.
- [x] `I61.17` Defect (Edward, 28 Sep: "clicking campaign at risk sends the user to the campaign page, but does not
  filter to the 2 campaigns"): the campaigns list gains an Alerts filter (At risk / Late), and a dashboard card opens it
  set — `?alert=atRisk|late`, plus `&client=` when the dashboard is on one client — on All. The late-task rule moved to
  `lib/campaigns/pulse.ts` so the card and the filter count the same. Walked as the CEO: both cards open on the 2
  campaigns they counted.
- [x] `I61.12` **Browser tests for the dashboard's three new controls** (`db-stat-*`, `db-tab-*`, `db-mine-*`):
  `check:e2e-coverage` reports them as NEW gaps. Tests are on hold (Edward, 27 Sep) — cover them or put them on the
  baseline: Edward's call. **Done 1 Oct:** `e2e/local/coverage/dashboard-controls.spec.ts` — the planner's Today /
  Tomorrow / This week each list their own booked task, a row opens the task page; the lead's view has no such list.
  `db-stat-*` was already pressed (`the-second-gate.spec.ts`); `db-tab-*`, `db-mine-*` off the baseline.
- [ ] `I61.13` **Power Admin: count personal grants outside a person's role or department, and bookings open past 30
  days** (I61.4's remaining recorded rows).
- [x] `I61.14` **Delete the unrouted Overview** (`dashboard/DashboardPage.tsx`, `CompanyHealth`, `UnassignedWork`,
  `BriefsAwaitingApproval`, `ExtensionRequests` and their tests) once the new Dashboard is accepted.
  **Done 1 Oct (Edward):** the five files, their three tests, `dashboard/api/dashboard-api.ts` and `team/CapacityBadge.tsx`
  (used only there) deleted; the 53 strings only they used removed from both locales.

### I60 — The campaign wizard without switches, and campaign languages (27 Sep, Edward) — ADR-0116, ADR-0117 accepted 27 Sep

Edward, 27 Sep. Four answers taken: every campaign piece is in a workstream (B — "single jobs is for one off pieces");
a translation task on every deliverable whenever any language is chosen (B — "as tasks can be removed"); placed straight
after Write Copy (A); each piece keeps its own language, from the campaign's (A). Both ADRs accepted 27 Sep. **Built 27 Sep** on `campaign-wizard-languages`: migration `20260927160000` (languages, `add_language`, the content writer's
workstream refusal and languages, the translation task in the task-list builder, `add_campaign_deliverable` naming its workstream),
pgTAP 188 (14/14) and 080/112/128/130/131/135/145/152/155 brought to the rule — the full suite on a fresh database 186 files /
2,538 tests; the seed's two campaigns given workstreams (dry-run checked). Checked in the browser on the local stack: step 1 with no
switches, Languages on step 2 (Arabic, English, Turkish added), a campaign released with one translation task per piece straight
after Write Copy; a single job with Arabic + Kurdish on step 3, the same. **Owed:** six browser specs/walks still press the removed
switches or the ungrouped line (campaign-phases, campaign-wizard, wizard-dialogs, the phases guide, the campaign-flow and
job-to-campaign walks) — tests on hold; the shared wizard helper is brought to the rule.

- [x] `I60.1` (ADR-0116) **No Phases switch on step 1** — the CB-v3-01 card: a line and + Add a phase; a campaign uses phases
  when it has one.
- [x] `I60.2` (ADR-0116) **No Workstreams switch; every campaign piece is in a workstream** — the work step will not go on
  while a piece is ungrouped; "Not in a workstream" leaves the work step, the piece dialog and Move; the campaign page's add
  and move name a workstream; `write_campaign_content` refuses an ungrouped campaign piece. Legacy ungrouped pieces untouched.
- [x] `I60.3` (ADR-0117) **Languages on step 2** — a smart-filter drop-down of the tenant's languages, several picked, each
  removable, + Add language; `campaigns.languages`.
- [x] `I60.4` (ADR-0117) **The language list** — English / Arabic / Kurdish ensured per tenant; `language` joins the admin
  Deliverable types page's attribute lists; `add_language` adds one a person types that is not there.
- [x] `I60.5` (ADR-0117) **One translation task per deliverable** — "Translation — ‹deliverable› (English, Arabic, Kurdish)",
  straight after Write Copy (else last), created once with the task list, whenever the campaign has a language.
- [x] `I60.6` (ADR-0117) **A piece's language offers only the campaign's languages** (all of them when none is chosen).
- [x] `I60.7` (ADR-0117) **Single jobs have languages too** (Edward, 27 Sep: "Single jobs need translation as well"; A) —
  the same control on step 3 under What is being made, saved with the job and restored on resume; its deliverables get the
  translation task.

### I59 — My Work, the team view and the department view: Figma sections E, F, G (25 Sep, Edward) — ADR-0105 – 0113 accepted

> Edward, 25 Sep: *"flows E, F and G are confusing as they are mixing up my-work with a completely new view (team
> for team leads) the associated view for a dept lead is missing. On the team view … the team lead's team and its
> members. On the dept view … the entire department by team. The my-work scope view is already established,
> therefore what should apply from this is only the styling and the extra functionality offered by the various
> panels."* And: *"all of the UI works needs to be done today"*, *"do not make any assumptions"*. Figma page
> `▶ CS v3 · Brief-first`: `E · TEAM LEAD` (`1585:2`), `F · TEAM MEMBER` (`1586:2`), `G · NEEDS YOU` (`1589:2`).
> The Figma is a proposal — these answers win over it. Built on `running-it`.

**Answered 25 Sep, one at a time (the question number is the session's):**
1. **My Work stays personal and the same for everyone.** The **Team** nav item becomes the team view (team lead,
   deputy) or the department view (department lead), replacing today's read-only Team page. (ADR-0018's tier 2.)
2. **"Needs you" replaces "Waiting for you" on My Work**, grouped *today or it slips / this week / quietly*;
   everything asking ME to act, a lead's team items included. The Dashboard is untouched (landing pages parked).
3. **Unassigned work shows in the deliverable OWNER's "Needs you" only** — the owner approves the task list and
   assigns (ADR-0100). A team member can never own a deliverable (`tg_deliverable_owner_is_a_lead`).
4. **The department view = the team view's four tabs, people grouped under their team** (team load on each
   heading), people with no team under "No team". A team lead sees only their own team.
5. **Roles with no team/department of their own get a department picker** (AD, AM, CEO, COO, Power Admin).
   **Traffic Manager holds every permission — Edward sets it on the Roles screen per tenant (his action on
   production; no code, no auto-grant — future tenants may not want it).**
6. **The team timeline drags**, reusing the Schedule's checks, adding *after the due date* (L6) and *at the
   ceiling* (L7) — warns, never refuses (ADR-0061 d.2).
7. **My Work lists: Today · This week · Later · Waiting on someone else · Completed (folded).** Attendance, the
   counts row, Awaiting review and Needs you stay; **Your week** and **Before you start** join (right column).
8. **A task page (M2 / M4)** opened from Open and from notifications; every pop-up's function moves onto it and
   the pop-ups go.
9. **A timeline bar is one TASK**, labelled *piece · task*, **coloured by its WORKSTREAM** (the existing stable
   hue), a key of the workstreams on screen, a **Workstream filter**; no-workstream work grey; state as a tag.
10. **Team view figures: Team (people, % booked) · At risk · Unassigned · In review.** The two "soon"
    placeholders go; "Needs your attention" becomes By-person notes + the over-capacity item.
11. **An extension request passes through the deliverable's OWNER first** — forward with a note, or decline
    (ends it); a forwarded one reaches the AM. Owner = AM → straight to them. **The AM may approve a shorter
    one** (between the current commitment and the date asked).
12. **"I'm blocked" = a required input on the maker's OWN task** (what / who has it / what you need); the owner
    and the AM are told; cleared by the maker or the owner.
13. **Blocked time comes off the maker's timer**, recorded separately. Time is measured from Start (ADR-0030).
14. **A round is UNTIMED if never started, or sent under 15 minutes (a setting) after Start** → warned, and if
    sent anyway it records the task's allocated hours, marked untimed (the KPI penalty's input). **The status
    back door is closed** — the assignee can PATCH `sub_tasks.status` today; review is reachable only through
    `sub_task_submit`.
15. **Change requests:** type, quantity, department or date edited on STARTED work becomes a request to the
    deliverable's owner — cost shown, *who asked* (client = spends a round; us = counts nothing). The owner
    **accepts / declines (reason) / pushes back (words + optional date)**.
16. **Work waiting on the client** shows in the AM's "Needs you", real elapsed time, one button **Mark
    received**. No client contact of any kind (no portal).
17. **Unassigned work escalates on campaigns too**, clock from the task list's approval. **Every clock is REAL
    time — weekends and closed days count** (Edward: *"most actions being escalated take minutes"*). Changes the
    local-only single-job rule (working hours).
18. **Nudge / chase = a notification + an email**, recorded against the piece. **Chat is not usable — fixing it
    is its own item (`I59.40`).**
19. **An alert chime** on notifications that ask for action; a per-person switch by the bell, on by default.
20. **No manual "Escalate now".** Automatic only.
21. **Escalation recipients are admin settings**: any roles + people relative to the piece (its owner, its AM,
    the owner's department lead, the assignee's team lead).
22. **Seven escalations, all real time, all editable:** unassigned 24h (Traffic, owner) · task list / brief
    unapproved 24h (Traffic, AM) · change request unanswered 8h (owner's dept lead, AM) · extension, owner's step
    8h (owner's dept lead) · extension, AM's step 8h (Account Director) · blocked 24h (owner, AM) · review:
    remind 24h (reviewers), escalate 48h (AM, owner).
23. **No "Insist".** On a push-back the AM accepts her version or withdraws (and may send a new request).
24. **Ask someone** (maker's task page, the lead reading a brief) = notification + email, **reply** from the
    notification, a **Questions** list on the piece. **The asker picks anyone**, the piece's people listed first,
    the AM pre-selected.
25. **"Too much"** goes to whoever assigned the task, with the maker's week; **Rebalance** / **Keep it with her**.
26. **Rules are SHOWN, not ticked** (*"they are rules that need to be followed"*): the card chip, Before you
    start, the task page — **and beside the file on the review screen.**
27. **The maker marks a pin done and replies to it; the reviewer can re-open it.**
28. **No "send the brief back"** — the owner uses Ask. **The AM owns the brief.**
29. **Filler text is refused at release and at campaign approval** (XYZ, TBD, TBC, TBA, N/A, lorem ipsum, …, -,
    x, test, digits only, one repeated character — an admin-extendable list), the field named.
30. **No "Later today"** on a review.
31. **Assigning stays on /schedule, as it works.** The assignment modal is RESTYLED to L2 only — same fields,
    same behaviour, no new picker. Needs-you's Assign / Rebalance / Reassign open the Schedule filtered.
33. **Reduced scope not acknowledged** → an AM "Needs you" item, **Record the acknowledgement** (the existing
    form). Never blocks work (22 Sep).
34. **No "For your eyes".** Reviews reach only the reviewers named at assignment, mandatory and optional
    (ADR-0043) — an owner who wants to see is added as an optional reviewer.
35. **The side menu keeps every item each role has today**, restyled.
36. **Assign and drag on BOTH the Schedule and the team timeline** — the same records; both refresh every 20 s
    and on returning to the tab (the Schedule does not refresh at all today).
37. **Over capacity → the person's team lead (and deputy) AND department lead, over 110%** — an admin setting.
38. **The maker's "Needs you": changes came back, new on you** (Later = seen). Unblocked is the existing
    notification and the card, not an item.

**The plan's five open details, answered the same evening:**
- D1. **Needs you is grouped by the clock** — *today or it slips* (escalates within 8h, already escalated, or
  its task due today / overdue) · *this week* (any other clock) · *quietly* (no clock); most urgent first.
  **Everything that needs action is in it** — reviews, approvals, responses.
- D2. **The Awaiting-review panel folds into Needs you** — each review card keeps what the panel shows (maker,
  who has not acted, required / optional, manual, Review).
- D3. **"Change request declined"** is an AM Needs-you card with the reason — Send a new request · Close.
- D4. **The team view has week arrows, back and forward, as /schedule does**, on Timeline, By person, By piece.
- D5. **A drag past the committed date warns (L6) and offers "Move it anyway"** on both screens — the task moves
  and shows late; asking for the extension stays optional (ADR-0061, warn never refuse).

**The build's questions, answered 25 Sep (E1–E14):**
- E1. **"Nobody yet" on a team lead's view = unassigned tasks on deliverables OWNED by someone in that team**
  (*"unassigned work belongs to a deliverable… it should show in their view"*). No second rule. The department view
  shows every unassigned task in the department.
- E2. **By piece "For" = time in the current state**, real time (in progress since Start, in review since sent,
  unassigned since the task list's approval, assigned-not-started since assignment, blocked since raised).
- E3. **The owner's forwarding note is REQUIRED.**
- E4. **The owner is told of every AM answer** to a request they forwarded (notification only).
- E5. **A due-date change asks for the client's evidence but never blocks** — on a change request AND on the
  existing due-date route (relaxes ADR-0088 d.7a "no attachment, no change"). Every change is logged with whether
  evidence came with it. *"This is logged so we can see the record."*
- E6. **Changing a deliverable's owner needs no approval** (*"has no impact on the tasks"*) — the existing Change
  owner, saved straight away; the department follows (ADR-0102). Change requests cover **type, quantity, due**.
- E7. **A type change on started work is allowed through a change request**: on acceptance the new type's tasks
  are added unassigned for the owner to approve, the old type's OPEN tasks are cancelled, finished ones kept.
- E8. **Escalation row 2 splits**: task list not approved (waits on the owner) → Traffic + the AM; campaign /
  brief not approved (waits on the AM) → Traffic + the Account Director. 24h each.
- E9. **An escalation that resolves to nobody goes to Traffic, and admin sees "reaches nobody" on the setting.**
- E10. **Filler is checked on EVERY field that has text**; a blank optional field stays allowed.
- E11. **A task cannot be assigned without hours allocated** — mandatory on every assignment route, refused by the
  database. The 89 hour-less tasks on the local database were all made by the automated tests (Cov review…,
  Phases…), not by use — there is no evidence of any on production; tests that assign must give hours.
- E12. **Blocked time counts both kinds**: the task's own blocks and inputs on its whole deliverable, overlaps once.
- E13. **"N/A" and a number on its own are real answers, not filler** — the templates' guidance asks for them;
  "XYZ 123" is still filler (`20260926140000`). Also: the migration `…136000` (13:60, not a time) was renamed `…135500`.
- Settled by the coordinator within those decisions (listed so they can be overruled): a single job's
  "nobody assigned" clock also starts at task-list approval; text that begins "lorem ipsum" is filler; the maker can
  undo their own "done" on a pin; clearing a block tells whoever waited (a new `task_unblocked` notification); a
  block's kind is required; a cleared block is not re-opened (raise a new one); the owner step is skipped when the
  owner asked; a drag from "Nobody yet" onto a person with no reviewer opens the assignment dialog; another week's
  header reads "…, week of <date>"; the picker's At risk follows the picked department; "New on you" is seen
  server-side (the task page opened), not per device; approvals take their clocks from the escalation rules; a
  waiting time reads in hours under 48h (the Figma's "26 hours"), in days after; By piece's Where column shows
  Blocked; a move of assigned work with no hours opens the assignment dialog; the task page shows the receipt's
  screenshot and reads through shared `src/lib/` code, not copies; Today shows only when not empty; reviewer
  notifications open My Work at the review card; Your week says when you are the most booked in your team.
- [x] `I59.31` The follow-ups E1–E12 and the settled items above, built (database + team view).
- [x] `I59.32` **Found 25 Sep (Track 11): "Add sub-task" let an assignee be picked with no hours**, so the database's
  E11 refusal was the only answer. The dialog now asks for hours whenever someone is assigned ("Give it its
  hours…", EN + AR). Open: should a chosen SLA profile's hours count instead?
- [x] `I59.33` **"New on you" is seen on the server** (`sub_tasks.assignee_seen_at`, `mark_task_seen`,
  `20260926150000`, pgTAP 180) — the task page marks it when its assignee opens it; Later marks it too. Open: the
  24-hour window still applies as well; the seen stamp touches `updated_at` and writes an audit row once per
  assignment.
- E17 (Edward, 26 Sep). **Action buttons are coloured by what they do, as the Figma draws them; the role does not
  change the colour** (*"green for approval, brown for change requests etc… roles remain as is with violet"*):
  approve / sign off = green filled (D3); send or accept a change request = brown filled (CG-E2, NY-AM-5); request
  changes, escalate, I'm blocked, decline / refuse = rust outline; every other main action = violet (system);
  secondary = grey outline.
- E16 (Edward, 26 Sep). **The review screen goes back to how it was before today**, keeping only ADR-0112's two
  additions (the rules beside the file — which were not showing — and the pin actions); the three tracks'
  other changes to it are undone. **The task page's "changes came back" view is built from Figma M4**, not by
  squeezing the review panel into the side column. And a Figma fidelity pass on every I59 screen (the earlier
  build had no Figma access and worked from the written plan).
- E15 (Edward, 26 Sep). **No "Later" button on "New on you"** — the card has Open and Too much; it leaves Needs
  you once the task is opened (seen on the server). Supersedes the Later of Q38.
- E14 (Edward, 26 Sep). **Today on My Work = due today, overdue, OR its booked work has begun** — the rule as
  built, kept; Q7's "due today or overdue" wording left out the third part.
- [x] `I59.35` **Found 25 Sep (Track 12): list reads silently stop at 1,000 rows** — the API returns at most
  `max_rows` (1000) per request, so the chat list (2,154 conversations for a department lead) and the campaigns
  list (1,056) dropped their newest rows without saying so. Both now read every page (`src/lib/query/all-pages.ts`).
  Edward, 25 Sep: *"Check all areas affected by row limits"* — every other list read swept the same way.
- [x] `I59.39` **The Edge Functions have the same 1,000-row limit** (found by the I59.35 sweep): 14 functions read
  tables through PostgREST and none pages. Edward, 26 Sep: fix now, the same way — inventory, page every read at
  risk, a test that fails without the paging. Done 26 Sep: `supabase/functions/_shared/all-pages.ts` (the frontend helper's
  copy, own tests); paged — booking-transition's capacity reads (confirmed bookings + unavailability, create and
  reschedule), subtask-schedule's ceiling check, list-user-status's tenant users, generate-deliverables' type
  catalogue (269 rows on the seed). The other reads are single-row, capped, or bounded by one piece of work.
- [ ] `I59.40a` Follow-ups from I59.39: the Edge Functions' paging helper (`supabase/functions/_shared/all-pages.ts`)
  is a COPY of `src/lib/query/all-pages.ts` (the src one imports `./in-chunks` without `.ts`, which Deno needs) —
  make one source; `booking-transition`, `subtask-schedule`, `list-user-status` have no handler test, so their
  paging is covered only through the helper; `expire_holds` counts `data.length` from an update's returned rows.
- [x] `I59.42` **Eight display defects found by looking at the walk's screenshots (26 Sep), fixed:** the side menu
  marked Dashboard AND Team current on /team; the team view's Nobody yet row stacked every unassigned task as cut-off
  chips in the first day's column; bar labels repeated the piece name ("Piece · Step — Piece"); the By-person load
  bar rendered as a blob; the changes-came-back view overlapped Upload V2 and the rules box; the task page's bottom
  bar hid the last content; the extension dialogs showed "—" for a missing committed date; the move warning's
  eyebrow ran off its pill. Tests per fix. (The review panel and M4 are re-done from the frame under E16.)
- [x] `I59.43` **The small pills on My Work and the task page go to 12px** (Edward, 26 Sep: *"make it larger.. try
  12 px"*). The frames set them at 8.5–9px; raised: the Needs you card's kind label, the Your week total, the task
  page's status and due pills, a pin's "done" pill. Column headings and the pin buttons are left as drawn. **E9
  confirmed as built (option A):** a rule saved with nobody on it still goes to Traffic and shows "Reaches nobody" —
  nothing is switched off by emptying a rule.
- [x] `I59.44` **Spacing and phones, site-wide (Edward, 26 Sep: *"text is directly adjacent to input field… make
  sure everything is responsive"*).** Measured first: every page at 1440 and 390px as the admin (+ the task page as the
  maker), label-to-field gaps, controls touching, and anything wider than the screen. **Spacing:** one standard, a
  label 6px above its field — `.field`, `.form-grid`, `.dialog label` (every dialog, was 3px), `.filter-bar` (was 2px),
  `.roles-detail-form`, `.brief-grid-edit`; four layouts that had NO rule get their styled twin's (`.filter-row`,
  `.inline-form` on Deliverable types, `.org-settings-form` on Organization, a generic `label.check`); the chime no
  longer touches the bell; a checkbox in `.org-add-form` was drawn 260px wide. **Phones:** 17 pages scrolled
  sideways (Users by 1,363px). Every `.data-table` now becomes labelled cards below 768px — Edward's earlier choice,
  whose CSS no table used — via `src/lib/dom/stacked-tables.ts` (stamps each header onto its cells, `data-stacked`;
  opt out with `data-no-stack`; the roles grid and team load stay tables and scroll in their own box); the
  schedule/deliverables/pipeline bars, zoom buttons and tabs wrap; the top bar wraps; roles stack; audit payloads
  fit. Re-measured: no page wider than 390px, no label gap under 4px. Not measured: dialogs other than Invite user,
  and states behind a click (the audit loads pages as they open).
- [x] `I59.45` **Found 26 Sep (Edward: *"all emails sent must provide accurate links to the action required"*): about
  half the email buttons land somewhere the action is not.** Checked every type in `notify-email` `deepLink` against
  where the action lives since I59. Wrong: (1) "review the task list and approve it" (`deliverable_added`,
  `deliverable_reassigned`, the deliverable form of `campaign_approved`) opens `/deliverables`, which has no Approve —
  it is on the campaign page's panel; (2) the maker's own task (`assigned`, `changes_requested`, `extension_approved`/
  `refused`, `dependency_ready`, `task_unblocked`, `task_reopened`) opened My Work with `?task=` — the row IS marked
  there (`my-work-item-`, TaskCard; first read wrongly as gone), but the bell opens the task page and the email now matches; (3) everything answered on a Needs you
  card (`too_much`, `task_blocked`, `question_asked`, `change_request_sent`/`answered`, `extension_requested` at the
  owner's step, `escalated`, `over_capacity`) opens `/deliverables` or plain My Work — and `/deliverables` is closed to
  anyone without `project_tasks:manage`, so a maker nudged or asked a question lands on a refusal; (4)
  `dependency_ready` / `escalated` (unassigned) say "assign it", but `/deliverables` cannot assign (I52.7). The in-app
  bell (`NotificationInbox` `href`) shares some of these. **Fixed 26 Sep (Edward: "fix it on the current branch"):**
  one table for the email and the bell, `src/lib/notifications/door.ts` (the email keeps its Schedule doors, which
  carry the week and person); Needs you cards carry `data-task` / `data-deliverable` / `data-resource` / `data-id`
  and My Work marks the card named by `?task=&kind=`; `/campaigns/piece/:deliverable` looks up the campaign for the
  bell; `assignment_overdue` no longer falls into the booking-request branch. Checked on the local stack: all 42
  notification variants inserted, every Mailpit button matched the table in `docs/reference/notification-email-copy.md`;
  My Work marked the linked review, new-on-you and change-request cards. `notify-email` is changed and undeployed.
- [x] `I59.46` **A department that does no production work is not offered for work** (Edward, 26 Sep: *"Finance,
  Support, and some others never get assigned deliverables, and neither the dept or user should be displayed as a
  choice on /schedule or where a dept needs to be picked … CS are assigned as reviewers and approvers"*). Decided:
  **one switch per department (A)**, on the Organization page with the existing setup; off → the department and its
  people leave the Schedule (rows AND its Department / Team filters) and every department / owner picker on a campaign
  or single job; reviewer and approver pickers keep them. Today `departments` has only a name. **ADR-0115 accepted 26 Sep**
  (live work refuses the switch, named; the Team page follows; the database refuses new work there).
  **Built 26 Sep:** migration `20260926190000` (`departments.is_production`, the switch guard, the new-work guards;
  also refuses moving the owner of live work into a switched-off department), pgTAP 183 (11/11); the Organization
  page's "Takes production work" tick (the refusal lists what must move); `useWorkDepartments` for the Team page and
  the job / workstream department pickers; owner and assignee lists and the Schedule's rows (hence its Department
  and Team filters) leave out switched-off departments' people. Checked on the local stack with Strategy switched
  off: gone from the Schedule filters, the Team picker and the single-job departments; back when switched on;
  Creative refused with its 136 deliverables / 542 tasks / 387 bookings named. The listed work is the database's
  English inside the Arabic sentence.
- [x] `I59.47` **Found 26 Sep (the job-to-campaign walk): "Done — Deliverable saved" opens ON TOP of the question it
  raised.** Moving a deliverable to another phase on an approved campaign saves, then asks "Change the promised date"
  (I59 E5) — and the page's success notice is drawn over that dialog, so the user is told it is done while a decision
  is still open under it, and must close the notice to reach it. The notice should wait until the date is answered
  (or say the phase moved and the date is being asked). Screenshot in the walk's test-results, 26 Sep.
  **Fixed 26 Sep (Edward: option A — hold the notice until the question is answered):** in `EditPieceDialog`, no
  notice while the promised-date question or the change request (started work, the same stacking) is open; one
  after: "Saved — moved to {phase}; the promised date stays {date}" / "… and the promised date changed" / "Saved —
  and the rest went to {owner} as a change request". Checked on the local stack, all three answers. **The
  job-to-campaign walk still closes a notice BEFORE the date question (written for the old order) — it will stop
  there until updated; not touched, per Edward (26 Sep: hold on test changes).**
- [ ] `I59.48` **Found 26 Sep: 20 browser specs race two outcomes with `Promise.race`, and the loser's timeout fails
  a later step at random.** The walks and `helpers/single-job.ts` were moved to `Promise.any` (it settles on the
  first to happen and absorbs the other's timeout; it still fails when neither happens). The same change is owed
  in `coverage/` (campaign-wizard ×2, escalation-settings, needs-you-actions, priority, schedule-page ×2,
  team-view) and `retest-redesign/` (d, e ×2, i, j, k, l, m, o, p ×2).
- [x] `I59.49` **A deliverable's OWNER is told when it is approved** (Edward, 26 Sep: *"On a deliverable being approved
  the deliverable owner and account manager/director should be notified"*). Found by the recipient check of the
  26 Sep walks: `signed_off` on a deliverable went to its tasks' assignees and the campaign's account manager (the
  field that also holds an account director standing in) — never the owner unless they held a task. Migration
  `20260926191000` adds the owner for `signed_off` only; still never the actor. pgTAP 184.
- [x] `I59.50` **Found 26 Sep, before the release push: `supabase db push` would have stopped at `20260923140000`.**
  It made `deliverables.owner_user_id` / `department_id` NOT NULL ("0 of 293 rows" — measured on the LOCAL database);
  production holds 100 ad-hoc/internal deliverables with neither (legacy, from before ad-hoc tasks took their assignee
  as owner on 29 Aug; Edward's query, 26 Sep). `20260923170000` drops both again an hour later in favour of
  `tg_deliverable_requires_owner`, so the two statements were removed from the un-pushed migration — the schema ends
  identical. Checked: `create_adhoc_deliverable` refuses a missing assignee and makes the assignee the owner, so the
  guard cannot block new ad-hoc work; the 100 rows are left alone by it. The other 64 migrations: no statement that
  validates existing rows can fail (allowed-value lists are supersets; new constraints are on new columns or tables).
- [ ] `I59.51` **ON HOLD (Edward, 27 Sep: automated tests on hold for now).** **Two controls have no browser test yet — put on the coverage baseline to release (Edward, 26 Sep: B).**
  `dept-production-*` (the Organization page's "Takes production work" tick, ADR-0115) and `*-notes-*` (the task
  list editor's Notes, I57.45). Owed: untick → the department leaves the Schedule's filter → tick back; write a note
  → save → it shows under the task. Then take both off `e2e/coverage-baseline.json`.
- [x] ~~`I59.52`~~ **DECLINED 26 Sep (Edward: "not necessary") — existing pieces keep no code; new ones get one.** Was: **Found 26 Sep after the release (Edward, the CG-01 grid): the ID column is blank on existing work.**
  `deliverables.code` (I56.9) is stamped on INSERT (and re-stamped on a move between campaigns) by
  `tg_deliverable_stamp_code`; `20260923230000` added the column with no backfill, so every campaign piece created
  before 23 Sep has none — nearly all of production. Locally all 174 have one (the database is newer than the codes).
  Proposed: a one-off backfill migration, same rule (workstream letters or WS, numbered by creation order within
  the campaign), only where `code is null`; ad-hoc work (no campaign) stays without. Awaiting Edward's go-ahead.
- [x] `I59.53` **A workstream's code letters are fixed when it is made** (Edward, 27 Sep). They were read from the
  workstream's CURRENT name at each piece's creation, so a rename split one workstream into two prefixes (DA-… then MO-…).
  Migration `20260927100000`: `workstreams.code_letters`, set from the name on insert and never changed (a rename keeps
  them; an update cannot move them); existing workstreams take their current name's letters; `tg_deliverable_stamp_code`
  reads them. No piece's code changes. pgTAP 185 (6/6). **Still open, not asked for:** letters a person types at creation
  (the frames' IA / TV / INF differ from the rule's IN / MT / IN), and what an ungrouped piece is coded (`WS` today —
  options: its department, its type, the campaign's initials).
- [x] `I59.54` **A person chooses a workstream's letters when making it** (Edward, 27 Sep: option A — suggest, and let
  them change it). The frames show `IA` / `TV` / `INF` where the rule gives other letters. Built: migration
  `20260927120000` — typed letters (two to four Latin letters, stored in capitals) kept on insert, empty means the rule's;
  `insert_campaign_workstream` / `write_campaign_content` (`codeLetters` per workstream) and `save_workstream`
  (`p_code_letters`, ignored on a rename) carry them; pgTAP 186 (11/11; 150/152/154/156/185 still green). App:
  `src/lib/campaigns/code-letters.ts` (the rule mirrored for the suggestion, 17 unit tests); the wizard draft, the save
  and the submit carry `codeLetters`. **The Letters box**, beside the name in `NewWorkstreamDialog` (CB-v3-P3 has no box;
  added to the frame's field style) and in the campaign page's `WorkstreamsPanel` form: filled from the name, following it
  until the person types; refused in words when not two to four letters; a rename shows none. Checked in the browser on
  the local stack (dialog: suggested INF, refused I1 and empty, typed IA reaching the saved draft; page form: typed TV
  stored), every screenshot opened. Browser test owed — `*-letters` on the coverage baseline (tests on hold, 27 Sep).
- [x] `I59.55` **The Team timeline, and the version** (Edward, 27 Sep). Full names, not nicknames, on the Timeline (rows, the
  move warning, the assign dialog); every bar — assigned or not — shows a hover card with the task, its client, campaign,
  workstream and due date (the client now read with the campaign); a click on a bar opens its task page (A). The badge reads
  "Alpha V 0.7.0" (Edward: "remove the duplicate… make it Alpha V 0.7.0") — `APP_VERSION` and package.json 0.7.0. Checked in the
  browser as a department lead.

- [x] `I59.56` **A campaign task's page shows "There is no brief for this piece"** (found 27 Sep, Edward: "every page … shows no
  brief and no task details"). `useTaskBrief` (src/lib/campaigns/piece-reads.ts) reads only the DEPARTMENT brief
  (`campaign_briefs` by department); ADR-0100 (23 Sep) gave a campaign ONE brief on `campaigns.brief`, so every campaign made
  since has none there. Single jobs are unaffected. Proposed: fall back to the campaign's brief, labelled as the Brief view labels it.

  **Fixed 27 Sep:** the brief is found by the DELIVERABLE's department (Edward: "a task sits under a deliverable… the
  deliverable has the owner and the owner's department"), falling back to the campaign's own brief, labelled as the Brief view
  labels it — on the task page and My Work. **Rules too** (Edward: "both campaign and client rules should display when they
  are available"): `useTaskListRules` takes the deliverable; a department brief's snapshot where there is one (single jobs),
  else the campaign's own rules then the client's profile rules — task page, My Work, Before you start, the review panel, the
  task-list approval. **And the campaign's rules were never saved** (the wizard held them in memory only, I56.6): now kept on
  the draft and the campaign's brief, restored on resume. Checked in the browser: a campaign made with one DON'T shows it on a
  task, above the client's three.
- [x] `I59.57` **The owner and the leads edit a task on its page** (Edward, 27 Sep: "the task page for everyone that wants to
  view or edit… the owner and associated dept and team leads should also be able to edit"; A — everything the task-list row
  has). "Manage this task" shows that task's row from the task-list table (`DeliverableDetail` `onlyTaskId`) to the
  deliverable's owner and whoever holds `project_tasks:manage`; the database still decides reach. Checked in the browser.
- [x] `I59.58` **By person, By piece and Load showed nicknames** (Edward, 27 Sep) — full names, as the Timeline (I59.55).
- [x] `I59.59` **The Team page's "Unassigned" counts tasks nobody can or should assign** (found 27 Sep on production:
  89 shown, 7 real). Query `Claude outputs/2026-09-27-cleanup/04_unassigned_tasks_check.sql`: 20 on projects not yet
  released, 5 left on deliverables already approved/delivered, 57 on task lists not yet approved (the ADR-0100 second gate),
  7 genuinely waiting. The count takes every task with no assignee that is not done/cancelled (team-view-api). Put to
  Edward: count only work ready to assign (A) or keep all and show the split (B). **A, built 27 Sep:** the Team page (figure,
  Nobody yet row, By piece) takes an unassigned task only on a released project, with its task list approved, on a deliverable
  not approved/delivered (`readyToAssign`, team-view-api). Checked locally: Creative's figure 543 → 234, equal to the query's
  ready count. **Still open:** the 5 leftover tasks on finished deliverables — put to Edward.

- [x] `I59.60` **A deliverable closes on its FIRST approved task when the rest were never assigned** (found 27 Sep tracing
  I59.59's 5 "leftovers"). ADR-0052 d.10 lets an unassigned, unstarted, never-worked task not hold sign-off (a "plan"), and
  ADR-0077 closes a deliverable itself once it has an approved task — so K one / O deck / Mail job (local) went to Approved
  10–26 s after release with 1 of 4–6 tasks done. Guard: `app.tg_deliverable_transition_guard` (latest 20260914160000).
  Put to Edward: never close with untouched tasks (A, needs an ADR) or close and cancel them (B).
  **Built 27 Sep — ADR-0118** (Edward: "A Deliverable is approved only once all tasks are approved… there should be no
  approve button for a deliverable" → "Yes"). Migration 20260927180000: `app.maybe_complete_sub_task` and the transition
  guard approve a deliverable only when every task is done or cancelled (no "plan" exception); every Approved deliverable
  with an open task goes back to In progress (guard stood aside, no revision round counted), Delivered ones left and listed
  in the push output. The manual in_review → approved transition is gone from `state-machine.ts`, so neither the
  Deliverables page nor the `deliverable-transition` function offers it; the "sign off anyway?" prompt went with it.
  pgTAP 189 (new), 065 updated.
- [x] `I59.62` **The Deliverables page still offered Start, Submit for review and Request changes** (Edward, 27 Sep:
  "Why are there start and request change buttons on the deliverables panel?" → A). Leftovers from before ADR-0077: a
  deliverable starts when its first task does, and a task's own send-back takes it out of review. **Built 27 Sep —
  ADR-0118 d.5:** draft → in_progress and in_review → in_progress removed from `state-machine.ts` (page and
  `deliverable-transition` function); in_progress → in_review stays for the ad-hoc send in TaskPage only and is
  filtered off the page. Mark delivered, Block / Unblock, Reopen and Cancel job / Archive stay. Unused labels removed.
- [x] `I59.66` **A re-opened task is not put back on anyone's schedule** (Edward, 27 Sep: "I have reopened 5 tasks, but
  they are not appearing for assignment on schedule"). Production, read-only check: the 5 "Create Brunos Static Post" tasks
  are todo, still assigned to Zubaida Jamil Ibrahim, due 29 Sep, 2h each — and their only booking is the old one (15–17 Sep,
  in the past). `app.reopen_one_task` (ADR-0103 d.2) keeps the assignee but never re-books; being assigned, they are not
  in anyone's "to assign" list either. So the work is on nobody's week. Put to Edward.
  **Built 27 Sep — ADR-0121** (Edward: B, "fixed now"). Migration 20260927230000: `app.reopen_one_task` clears the
  assignee, start and commitment and releases the bookings; reviewers told, not the previous maker; the data fix puts
  back every task re-opened and left unbooked (production dry run: exactly the 5 Brunos posts). pgTAP 157 updated; the
  re-open window's wording (en, ar). Walked locally: the re-opened tasks are offered in the Schedule's booking dialog.
- [x] `I59.65` **The Account Director has no My Work** (Edward, 27 Sep: "the account director and most likely the account
  managers do not have my-work… why?"). Production, read-only check 27 Sep: account_director holds neither `my_tasks:view`
  nor `my_calendar:view`; account_manager holds `my_tasks:view` (5 people, no personal blocks), so AMs do see My Work.
  Cause: the Director role (5 Sep, 20260905190000) was made as a COPY of the AM's grants that day; the AM was given
  `my_tasks:view` on 16 Sep (I51.8, 20260916130000), which backfilled "only the account_manager role — not a cascade".
  New tenants are unaffected (the seed copies the AM's grants after they include it); local has it for that reason.
  **Fixed 27 Sep by Edward on the Permissions page:** `my_tasks:view` granted to Inas Mohamed Azmi, the one Account
  Director, as a personal grant (not the role). A second Director would start without it; granting the role would cover that.
- [x] `I59.64` **View Maestro as a named person, read-only, for a Power Admin** (Edward, 27 Sep: "I need to showcase the
  site to one of the C-level on Wednesday… how can we use dev: view as to show the actual live data for the various
  users?" → A). Dev: View as previews a role only; every "me" page shows the admin's own (empty) work. ⚠️ ADR-0120
  (proposed): a header the database honours only for a Power Admin, same tenant, read-only transaction, claims swapped
  to the person's; every use in the audit log, the person not told; Chat unchanged (not live). Needed by Wed 30 Sep.
  **Built 27 Sep — ADR-0120 accepted.** Migration 20260927220000: `public.view_as_pre_request` (registered as
  `pgrst.db_pre_request`), `public.view_as_start`, `app.view_as_target`. Client: `lib/view-as.ts` adds the header;
  `auth-context` swaps the session to the person (kept across a reload in the tab); Dev panel Person picker; the
  "Viewing as" bar; no check-in ping while viewing. pgTAP 191; walked on the local stack. Browser test owed
  (dev-person* in the coverage baseline).
- [x] `I59.63` **The Dashboard's Unassigned work panel counts work nobody can assign** (found 27 Sep checking I59.59;
  Edward: "separate fix", after the I59.59/60/62 PR merges). Its view `unassigned_work_by_campaign` counts every unassigned
  open task — unreleased projects, unapproved task lists, finished and even archived deliverables. Give it the Team page's
  rule (ADR-0118 d.3) so both show the same total. Needs a migration.
  **Overtaken 29 Sep:** the role dashboards (`5153df8`, I61) replaced `/dashboard` with `RoleDashboardPage`; the panel
  (`UnassignedWork`) survives only in the unrouted `DashboardPage` and goes with `I61.14`. Nothing routed reads the view.
- [x] `I59.61` **Unapproved task lists as an exception on the department and team leads' My Work** (Edward, 27 Sep: "the
  tasks list that have not been approved need to be displayed as well… as an exception on their my work page"). After I59.60.
  **Built 27 Sep — ADR-0119** (Edward's answers: department lead and every team lead of the deliverable's department;
  team leads approve from the card, as production grants them; older campaigns included; their escalation timed from
  release day; one rule for all work). Migration 20260927200000: the cut-over exemption in
  `app.deliverable_work_acceptance_refusal` removed; `app.leads_department` and `app.task_list_waiting_since` (new);
  `my_pending_approvals`' task-list card to the owner and the department's leads where they may approve; `escalation_due`'s
  task_list rung for every campaign, older ones from `task_list_backlog_from` (set at release). No UI change — the Needs you
  card already existed. pgTAP 190.

- [x] `I59.34` Integration, 25 Sep: all 22 migrations applied to the LOCAL database only and
  `src/types/database.ts` regenerated from it (Edward: *"you can run the local database"*); the full local
  browser suite run with a JSON report (`Claude outputs/e2e-2026-09-25/`).
- [x] `I59.36` **Found 25 Sep: six browser tests passed only on months of leftover data.** On a freshly reset local
  database (migrations + `seed.sql` only) the suite gave 253 / 6. Edward: *"Make sure to seed with all the data
  required and use human readable names."* Each spec now makes what it needs through the product: My Work gives the
  deputy a task due today and runs serially (its tests build on one job); Waiting for you releases its own Content
  job for the held task list (ADR-0100 d.7's pre-cutover exemption cannot exist on a reset database, so it is no
  longer asserted in the browser); D2 holds the release reply 900 ms so its please-wait modal can be seen, as L2
  does; the audit test checks the log holds more than a page and that More loads exactly the next one.
- [x] `I59.37` **A new tenant had no languages** — `20260923230000` inserted Arabic / English / Kurdish into the
  tenants that existed then and never into provisioning, so every tenant since (and every `db reset`) offered none
  in the piece and rule dialogs. `app.seed_tenant_languages`, called by the wrapper (`20260926180000`); pgTAP 114.
- [x] `I59.38` **The audit log's More loaded nothing past a shared instant** — the cursor was the time alone, and one
  transaction stamps all its rows with one `created_at` (provisioning: ~2,000). Paged by (time, id) now.

**To do — the decision record first, then the build:**
- [x] `I59.1` **ADR-0105 – ADR-0113, accepted 25 Sep** (one decision each): 0105 My Work personal / Team is
  tier 2 / Needs you (amends 0018) · 0106 untimed rounds, review only by sending (0030) · 0107 a maker's block on
  their own task, blocked time off the timer (0069, 0030) · 0108 real-time clocks, seven configured escalations
  (0045) · 0109 the owner judges an extension first, a shorter approval (0088) · 0110 a change to started work is
  a request · 0111 filler refused at release (0085) · 0112 reviewed against the rules, the maker answers pins
  (0025) · 0113 asks, nudges and "too much" by notification + email, the chime (0027). **Edward approves before
  any of I59.10 onward is built.**
- [x] `I59.2` The view-by-view plan (each view and panel: who, structure, content, kept, new) — approved by Edward.
- [x] `I59.10` My Work restyled: Needs you, the five lists, Your week, Before you start; nothing removed (1, 2, 7, 38).
- [x] `I59.11` The task page M2 / M4, the pop-ups retired (8, 26, 27).
- [x] `I59.12` The team / department view: four tabs, figures, picker, grouping, workstream colour + filter (1, 4, 5, 9, 10).
- [x] `I59.13` Timeline drag + L6 / L7 warnings, shared with the Schedule; both refresh every 20 s (6, 36).
- [x] `I59.14` The assignment modal restyled to L2 (31).
- [x] `I59.15` The side menu restyled, every item kept (35).
- [x] `I59.20` Untimed rounds + closing the status back door (14).
- [x] `I59.21` I'm blocked on a task; blocked time off the timer (12, 13).
- [x] `I59.22` Extension: the owner's step; approve a shorter one (11).
- [x] `I59.23` Change requests on started work (15, 23).
- [x] `I59.24` The escalation settings (recipients + hours, real time) and the sweep extended — seven kinds, the
  110% alert, campaigns (17, 20, 21, 22, 37).
- [x] `I59.25` Nudge / chase / Ask with replies — notification + email, the Questions list (18, 24).
- [x] `I59.26` Too much (25). Waiting on client + Mark received (16). Reduced-scope reminder (33).
- [x] `I59.27` Filler text refused at release and approval; the admin list (29).
- [x] `I59.28` The alert chime + its switch (19).
- [x] `I59.29` Rules on the review screen; pins marked done / replied / re-opened (26, 27).
- [x] `I59.30` Browser tests for every new control, EN + AR; the `WALK=1` review walk with embedded screenshots.
- [ ] `I59.40` **ON HOLD (Edward, 27 Sep: a large piece of dedicated work).** **Chat is not fully functional or real time** (Edward, 25 Sep: *"needs real work to fix"*). Not in
  today's scope; nudges and questions use notifications + email until it is fixed.
- [x] `I59.41` Traffic Manager given every permission on production — **Edward, on the Roles screen.** **Closed 30 Sep (Edward): no problem with the role; it is adjusted on the Roles screen as required.** **Except `roles:manage`** (Edward, 28 Sep: A) — changing roles stays with the Power Admin, and Traffic keeps the Traffic dashboard (ADR-0122 d.2).

### I58 — Re-opening finished work (25 Sep, Edward) — ADR-0103 accepted

*"we need to be able to re-open campaigns that are complete, … deliverables and associated tasks that are marked as
approved and complete … allowed by Account Director, Account Manager, Traffic Manager, Power Admin, the assigned
deliverable's owner's department leads and team leads."* Edward's four answers of 25 Sep are in ADR-0103.

- [x] `I58.1` ADR-0103 accepted (Edward, 25 Sep — on `running-it`).
- [x] `I58.2` `app.may_reopen` — `project_tasks:manage` and reach over the AM or the owner's department (d.1); pgTAP.
- [x] `I58.3` `reopen_task` — done → To do, same people, approval cleared, reason and new due date required, both told (d.2).
- [x] `I58.4` `reopen_deliverable(tasks[])` — the picked tasks re-open, the container to In progress; the bare
  approved → in_progress move leaves the guard (d.3).
- [x] `I58.5` `reopen_campaign` on d.1's authority; a re-open inside a closed campaign re-opens it, saying why (d.4).
- [x] `I58.6` Two notification types (task re-opened, to the assignee and reviewers), mail words EN and AR.
- [x] `I58.7` The screens: Re-open in the drawer, the deliverable page, the task row and the card menu; the pick-tasks
  dialog with reason and date (d.5).
- [x] `I58.8` Browser tests for every new control (`e2e/local/coverage/reopen.spec.ts`, 7 tests, EN). **Built 25 Sep:**
  migrations `20260925100000` (re-open) and `20260925110000` (ADR-0104), local only; pgTAP 157, 158, and 138 / 045
  brought to them. The EN+AR walk of the three re-opens is not written — the coverage spec presses every control.

### I57 — Running it: the campaigns list and the campaign page, section D (24 Sep, Edward)

**ACCEPTED 28 Sep (Edward: "we accept D, but will have minor cosmetic changes to make").** The
cosmetic changes are dealt with separately, as Edward names them — not under this section.

> Edward, 24 Sep: *"CG-00 should display campaigns… CG-01 Campaign Grid — when a user selects a
> specific campaign this is the page that opens. The tabs at the top should switch the view according
> to the UI provided. The Season Map tab displays the number of deliverables in each phase for
> campaigns with phases, 1 square per deliverable… Create tests as you proceed."* Figma section
> `D · RUNNING IT` (node `1570:59`): CG-00 Campaigns, CG-01 Grid, CG-02 Season map, CG-03 Where is
> everything, CG-05 Board, CG-06 Timeline, CG-07 Brief, CG-E1 Edit, CG-E2 Change request. Built on
> branch **`running-it`, cut from `flows-22-sep`** — two branches from main; review fixes on
> `flows-22-sep` are brought across only after telling Edward.

**Answered 24 Sep, one at a time:**
1. **Everyone still sees every campaign** (the 12 Sep decision stands; CG-00's per-role list is NOT a
   lock). Most people are read-only — changing a campaign needs `projects:manage` (Power Admin,
   Account Director, Traffic Manager, Account Manager, Department Lead). The list gains **filters and
   a smart search** and opens on **Mine**; an empty Mine falls back to All.
2. **"Mine"** = I am the campaign's account manager, OR I am on it in any of four ways: I own a
   piece, hold a task on it, review it, or own a workstream.
3. **The card** is the frame's (name, line, delivered of total, Open) with **today's status badge**
   (Draft / Pending approval / Approved / Closed) and **separate alert badges**, each shown only
   above zero: **At risk**, **Waiting on client**, **Tasks unassigned**, **Task lists to approve**.
   Search, show closed and drafts stay; Close out / Reopen move into a menu on the card.
4. **At risk is ADR-0075** (accepted 6–9 Sep, never built): whatever threatens the deadline. Date
   checks first — not started in time, task list not approved, stuck in review, the last task too close
   to the due date to leave the review day, past due; a task short of time only because a colleague's
   input is outstanding reads *waiting*, and the colleague's task carries the risk. The hours-vs-booked
   check follows straight after.
5. **Waiting on client — TEMPORARY rule until the client portal exists, nothing set by hand.** The
   client's approval is outside the system today (Edward, 24 Sep): **Approved** is the INTERNAL approval —
   the piece approves itself when its last task is approved (ADR-0077) — and **Delivered** means the client
   approved it and was handed the final product, pressed by hand. So a piece is waiting on the client when
   it is **approved and not yet delivered**, OR it has an outstanding external input
   (`deliverable_pending_inputs`). Known weakness: an input from a supplier counts as the client, and a
   Delivered press forgotten leaves the piece reading "waiting on client" — which is itself worth seeing.
6. **The department tabs go.** The owner's task-list approval (ADR-0100) moves into the Grid — its
   Approved column and a "Needs approval" filter.
7. **Nothing sets a piece's stage by hand.** The Board and the Edit dialog SHOW where a piece is; cards
   move as the work moves. No dragging. Closing a piece stays. Change requests (CG-E2) stay deferred.
8. **Grid columns:** ID, Piece, Format, Channel, **Creative** = the piece's owner, **Managed** = the
   workstream's owner, **Executed** = who holds its tasks, **Languages** (not the frame's KU), Due,
   Status, Approved. In-place cell editing later; Edit opens the piece dialog.
9. **Season map:** rows are workstreams (departments when a campaign has none), columns are phases
   with their NAMES and dates; the frame's event line (*▲ Draw Night 1 · Fri 25*) is left out — the
   event was removed 24 Sep. Tab hidden on a campaign without phases. A closed piece leaves the map.
10. **"Blocked" becomes "Waiting"** (the 3 Sep rule: work is never marked blocked). Red on the map and
    the timeline means late.
11. **The clock on Where is everything** uses item 4's rule: on time / due soon / late by N days.

- [x] `I57.1` **The at-risk rule** (ADR-0075 d.4/d.5, date checks) as one tested engine in
  `src/lib/`, read by every screen below. `src/lib/deadlines/at-risk.ts` (`assessRisk`): late, not
  started by its committed start, too few working hours left (named as the task list when it is
  unapproved), stuck in review past the one-day buffer, the last task too close to the piece's date;
  waiting on a prerequisite or an outstanding input is WAITING, not at risk. 16 unit tests.
- [x] `I57.2` **Waiting on client**, the temporary rule (answer 5), beside it. `src/lib/campaigns/pulse.ts`
  (`isWaitingOnClient`, `campaignPulse`) — also the four badge counts and who is ON a campaign.
  **Tasks unassigned counts only under an APPROVED task list** (before approval nobody may be
  assigned, ADR-0090 — those are the task-list badge's).
- [x] `I57.3` **CG-00 the campaigns list**: cards, badges, Mine / All, Client, Account manager, Status,
  smart search (name, client, brand, piece code, piece name, person), show closed, drafts, the card menu.
  `CampaignsPage.tsx` + `lib/campaign-cards.ts` + `api/campaign-pulse-api.ts` (flat, paged reads).
  The go-live reads as a short day (`formatIraqShortDate`). Browser: section H rewritten (H1–H8,
  H2b, H4b); E2, L1, L4, L6 and the two promote/continue steps press the menu and All.
- [x] `I57.4` **The campaign page's tabs**: Brief · Where is everything · Grid · Season map · Board ·
  Timeline; the department tabs retired, their task-list approval moved into the Grid.
  **Brief and Grid built 24 Sep; the page opens on Grid.** A view is listed once it is built (no tab
  onto nothing). Old links still land: `?tab=campaign` → Brief, a department id or `all` → Grid.
  What the department tabs did, and where it went: task-list approval → the panel on the Grid and
  "Needs approval"; Add → "Add a piece"; Edit (name, type, quantity) → the row's Edit; a single
  job's brief and any legacy department brief → Brief; assigning stays on /schedule (Edward).
  **Interim until their frames:** the phase select and the evidenced due-date change sit on the
  grid row until CG-E1 (`I57.11`); Open shows the piece's tasks under its row until the CG-04 drawer
  (`I57.16`). The workstreams panel sits under the grid.
  **No rings on the page (Edward, 24 Sep, option a):** the per-piece rings and the phase strip came off,
  as CG-01 draws neither; Manage phases / Turn phases on sit beside the tabs; what the rings said is
  the grid's Status and Executed, and returns in the season map and the brief. `campaign-rings.spec`
  now asserts the same live counts on the Executed column. The task-list panel shows the lists
  waiting and any approved during the visit — not the ones approved before.
- [x] `I57.5` **CG-01 Grid**, grouped by workstream, with its filters (workstream, phase, owner,
  status, needs approval) and + Add a piece. `components/CampaignGrid.tsx` + `lib/campaign-grid.ts`.
  Grouped by workstream, by department where a campaign has none. **Executed lists every task's
  assignee and counts the tasks nobody has** (Edward, 24 Sep: a piece's tasks can be several people's,
  and all are shown; the owner is the Creative column).
- [x] `I57.6` **CG-02 Season map**.
- [x] `I57.7` **CG-07 Brief** — the brief read-only, what it produced by workstream, empty fields.
- [x] `I57.8` **CG-05 Board** — no dragging; Waiting, not Blocked.
- [x] `I57.9` **CG-06 Timeline** — the working days each piece has; weekend shaded; late in red,
  nobody on it hollow.
- [x] `I57.10` **CG-03 Where is everything** — with whom, for how long, next, the clock.
- [x] `I57.11` **Edit** opens the existing piece dialog; status shown, not set; Close stays.
- [x] `I57.12` **The hours-vs-booked check** (ADR-0075 d.4, first line) added to `I57.1`.
- [x] `I57.13` The dashboard's and Team's "At risk" tiles read `I57.1` instead of *coming soon*.
- [x] `I57.18` (ADR-0102, accepted 24 Sep) **A deliverable's department follows its owner** (Edward, 24 Sep: *"we need
  to assign to people, not departments… the dept should be based on the assigned owner"*). Reverses ADR-0099
  d.2/d.3: an owner change moves the deliverable to the owner's department; a workstream move no longer
  does; live deliverables re-stamped once (7 locally). 
- [x] `I57.19` **Found by the section D walk (24 Sep): the Grid and the drawer read an internally approved deliverable as
  "Complete"** — their status reads the tasks' phase; it must say Approved (Edward, 24 Sep).
- [x] `I57.20` **The list card and Where is everything disagree on "at risk"** (card 3, Where 1 late): the card counts
  booked hours (I57.12), Where's clock does not. One rule, both screens.
- [x] `I57.21` **The Board wraps at 1440 wide** — seven columns do not fit one row; one row that scrolls sideways within the
  board (phones too).
- [x] `I57.22` **Brief "What it produced" shows a Waiting deliverable as not started** — it is not given the outstanding
  inputs the Season map uses.
- [x] `I57.23` **The workstreams panel under the Grid is unstyled** — names run into departments, bare bullets and dropdowns.
- [x] `I57.24` **Grid filters leave empty workstream headings** — a group with no rows left should not show.
- [x] `I57.25` **The drawer lists "Create Artwork … 2" before "… 1"** — tasks sharing a sort order need the unit number as
  the tie-break (the I57.15 cause, on screen).
- [x] `I57.26` **Small wording and cut-offs:** "4 task(s) will be cancelled" (plural it); the Timeline's late label cut to
  "5 days l…"; the card's account-manager name cut to "Dev …"; an English brief line in the Arabic drawer puts its full
  stop at the wrong end (isolate the text's direction).
- [x] `I57.14` Every new control has a browser test as it is built; `check:e2e-coverage` adds no gap. **Done 25 Sep:**
  `coverage/wizard-dialogs.spec.ts` (the last eight wizard controls) and `coverage/old-booking-requests.spec.ts`; the
  gate is 36 known, 0 new — the 36 are `I49.79`'s three unrouted pages, parked.
- [x] `I57.27` **Found 25 Sep: the workstream drawer's "Rename or move department" does nothing** — it closed the
  drawer. Edward, 25 Sep: **rename only** — the button is "Rename" and opens the new-workstream dialog with the name
  and no department (ADR-0102 d.2: a group's department moves none of its work).
- [x] `I57.28` **The five controls that answer an OLD booking request have no browser test** (`request-*` on the grid,
  the request dialog's approve / close / reason, `edit-withdraw-request`). None is raised since ADR-0098 (22 Sep), but
  requests from before may still wait in production. Edward, 25 Sep: **test them** — the spec plants an old-style request
  and answers it in the browser. The KPI, internal-project and admin-home gaps stay parked (`I49.79`).
- [x] `I57.29` **Found 25 Sep by the new wizard-dialogs spec: "Add another" leaves the saved piece in the form** —
  the piece is saved, but the dialog reopens with its name, type and owner still filled, so Save adds a duplicate. The
  dialog now remounts blank (a key bumped on each "Add another").
- [ ] `I57.30` **Found 25 Sep (screenshot of the piece dialog): its words still say a workstream sets the department** —
  the lede "It takes the workstream's department and manager" and the hint "sets the department: Content" under the
  workstream box. Since ADR-0102 the department is the owner's. Copy only, EN and AR. Also seen: two pieces saved in two
  languages read as identical rows in the drawer — the language is not on the row.
- [x] `I57.43` **The internal project form is removed** (Edward, 25 Sep: *"the internal project form is no longer
  required"*). `src/features/internal/` and its `internal.*` words, EN and AR; it had no route since ADR-0082 d.4. Its 11
  controls leave the coverage baseline (36 → 25; the KPI page and the admin home stay parked, `I49.79`). The database is
  untouched — internal projects that exist stay as they are.
- [x] `I57.44` **Found 25 Sep (Edward, from a real mail): "made you the owner… You need to review the brief and tasks
  and then approve"** — stale since ADR-0100: there is no brief to approve, only the task list. Same words in the
  `deliverable_added` mail and both inbox lines, EN and AR. And an owner change does not reset the task-list approval, so
  a new owner of an already-approved list is told to approve something already approved. **Built 25 Sep** (Edward:
  say what is actually owed; *added* says task list only): the notice records `tasks_approved` when raised (migration
  `20260925120000`, pgTAP 159, local only); mail and inbox read it — *"Review its task list and approve it…"* or *"Its task
  list is already approved, so its work can be assigned — it is yours to see through."* EN and AR.
- [x] `I57.45` **Found 26 Sep (Edward): the owner is asked to approve a task list they cannot edit from where they
  approve it.** The approval panel on the campaign page (`TaskListsApproval`) and the piece drawer show each list
  read-only with Approve; the campaign page's Edit covers the piece's own fields, not its tasks. Adding, renaming,
  re-dating, reordering, cancelling and re-opening a task exist ONLY on `/deliverables` (the task rows under a
  deliverable), a page behind `project_tasks:manage`, and nothing on the campaign page links there. An owner
  without that permission can approve a list and edit it nowhere. **Decided 26 Sep (Edward): A — the list is
  edited where it is approved**, in the approval panel: name, hours, due date, order, remove, add. No Figma frame
  covers it (checked 26 Sep: CG-04 shows the tasks, CG-E1 edits the piece only), so it is built in the panel's
  own look. **Each task carries NOTES** (Edward, 25 and 26 Sep): *"free text and anything relevant to the task
  itself"* — written by the owner on the list, read by the maker on their task page; stored in the existing
  `sub_tasks.description`, which no screen showed or edited until now.
  **Built 26 Sep:** `TaskListEditor` inside `TaskListsApproval` — a waiting list opens as an editor for whoever may
  approve it AND holds `project_tasks:manage` (so no edit is offered that the database refuses): up/down, rename,
  hours, due date, notes, remove (the delete icon's two-press confirm; `remove_sub_task` deletes or cancels), add.
  Existing writes only (`save_sub_task`, `remove_sub_task`, `resequence_deliverable_tasks`). `save_sub_task` coalesces,
  so an emptied hours or date box keeps the old value; notes are sent as '' to clear. The maker's task page shows
  a Notes card under the brief. Checked on the local stack as the Creative lead (edit, save with notes and hours,
  the add form, Arabic). Not yet checked: the Notes card on a maker's task page (no assigned task carries notes).
- [x] `I57.46` **The owner's task list lost its columns when it moved to "Task lists to approve"** (Edward, 27 Sep:
  *"the following columns are missing: Owner, SLA, Due, Status, Review (digital or manual), Required input and resources.
  Also missing cancel task and delete"*). Cause: I57.45 (26 Sep) gave the panel a new, cut-down editor instead of the
  deliverables page's task table. Fixed: the panel now shows that same table (`DeliverableDetail`, new `tasksOnly` mode —
  no heading, owner control, approval or chat), so the two cannot drift again; the cut-down `TaskListEditor.tsx` is
  deleted. The table's edit row gained what the editor had and it lacked: hours and the notes for whoever does it
  (notes also show under the task's name). Checked in the browser as the owner of a released single job: every column,
  hours and notes saved, Cancel task and Delete on each row, approve.

- [x] `I57.47` **"Open review" opened an empty panel** (Edward, 27 Sep: "why?"). It was offered on every task that was not
  cancelled, so a task nobody had started opened onto "No versions yet". Edward: A — and *"it should still show for completed
  and approved tasks… the button should not be removed, just grayed out"*. Now always shown, greyed out (with the reason on
  hover) until the task is in review, has been sent back at least once, or is done. The task rows read `revision_number`.
  `campaign-rings.spec.ts` brought to it (it asserted the empty panel). Checked in the browser.
- [x] `I57.48` **Task names carried the quantity** — "Creative Direction — Static Post ×3" (Edward, 27 Sep: "it should just be
  Creative Direction — Static Post"; A — existing tasks renamed too). Migration `20260927140000`: `app.task_segment` drops a
  trailing " ×N"; the task-list builder and the rename cascade use it; existing titles ending in their deliverable's
  counted name are rewritten (hand-edited ones are not). The deliverable keeps its name; unit numbers stay. pgTAP 187 (8/8);
  the full suite on a fresh database 185 files / 2,524 tests. Applied to the local database only (22 titles rewritten there).

- [x] `I57.31` **Rewrite the job-to-campaign walk** (`e2e/local/walks/job-to-campaign.walk.spec.ts`, Edward 25 Sep). It
  still drives department tabs, the phase select on the page and department briefs (retired on campaigns, ADR-0100).
  To the section D pattern: set-up and navigation are hard assertions, screen checks recorded, one HTML report with
  the screenshots embedded; the model stays real (Edward's 21 Sep ask). **Done 25 Sep:** ten chapters A–J in EN and AR, 20/20
  tests, 180/180 checks, 145 screenshots — `Claude outputs/reports/2026-09-25-job-to-campaign/REPORT.html`. Run it alone:
  it reads the whole Mailpit box.
- [x] `I57.32` **Rewrite guide 12, a campaign with phases** (`docs/guides/12-campaign-with-phases.md` and its shooting
  spec `e2e/local/guides/campaign-phases-guide.spec.ts`) to the five-step wizard (phases on step 1, dates on step 4)
  and the campaign page's views (Grid, Season map; the phase moved in Edit). No brief-template prerequisite.
- [x] `I57.33` **Rewrite guide 13, viewing and managing a campaign** (Edward 25 Sep: with 12 — one spec shoots both).
  The campaigns list as cards, the Grid, the drawer, Edit, Season map, Board, Timeline, Where is everything, Brief. Section
  D is still under the team's review, so 13 is re-shot after their feedback. **Done 25 Sep:** 14 + 22 images, shot by
  `GUIDE_SHOTS=1 … e2e/local/guides --no-deps` (hard assertions, only the model mocked); 28 stale images deleted.
- [x] `I57.34` **Found 25 Sep (guide 12's walk): in the wizard a piece's department comes from its workstream before its
  owner** (`BriefWizard.tsx` `pieceDepartmentId`, ~line 853) — the order ADR-0102 replaced. Step 4 shows an Edit Lead's
  TVC as Creative; after approval the database stamps it Production. The screen disagrees with what is saved.
- [x] `I57.35` **Found 25 Sep: step 4 plans a start before its phase starts, and in the past** (Edward, 25 Sep: **a start is
  never before today**; it MAY be before its own phase — *"a piece of work does not have to start within a phase, as
  long as it is delivered within the phase"*; the row goes amber when today leaves too little time) — Pre-Launch from today,
  its pieces "Start" yesterday (`src/lib/timing/plan-back.ts`). They are shown as reduced scope. **Built 25 Sep:** the floor is TODAY only.
  A first cut also floored to the phase's start (the option offered bundled it in); Edward refused it the same day, and
  it was taken out — MC-003 starts in Week 1 again, as `CB-v3-04` draws it.
- [x] `I57.36` **Found 25 Sep: Edit, after moving a piece to another phase, keeps a due date outside the new phase**
  (Edward, 25 Sep: **the date moves with the phase** — to the new phase's end, planned back) — **Built 25 Sep:** the new date is
  shown on the phase choice; whoever may change the promise gets the promised-date dialog pre-filled on Save (Cancel keeps
  the old date, the phase moves); whoever may not moves the phase and keeps the date, told who can; before approval the
  date stays (no door writes a due date then) —
  and the hint still reads "Inside the phase…" (`campaigns.editPiece.dueEvidencedHint`, `EditPieceDialog.tsx` ~295); no
  after-the-phase warning as the add form gives.
- [x] `I57.37` **Found 25 Sep: "Add 1 deliverables"** — `campaigns.generate.addAll` is not pluralised (EN and AR).
- [x] `I57.38` **Found 25 Sep: a phase refusal is titled "That did not work"** (`PhasesDialog.tsx` delete and turn-off
  refusals through the page notice) — it reads as a failure; it is a rule saying no, and should say so.
- [x] `I57.39` **Found 25 Sep, cosmetic: the Manage phases and Propose more dialogs stretch to nearly the full screen
  height**, mostly empty.
- [x] `I57.40` **Found 25 Sep: Re-open on a department brief is reachable nowhere** (Edward, 25 Sep: *"there should be
  the option to update the brief… manually"* — ADR-0104 d.3: the dead Re-open goes; a single job's released brief gets Edit) — `BriefView` renders `BriefApproval`
  with `canApprove={false}` (legacy briefs read-only, ADR-0100), so the button and its confirm are dead code, held in
  `e2e/coverage-baseline.json`. Remove it, or give it back to someone (a single job's approved brief has no re-open either)?
  Edward's call.
- [x] `I57.41` **Found 25 Sep (the job-to-campaign walk): promotion still re-opens and empties the job's department brief**
  (Edward, 25 Sep: *"promotion to campaign requires a new campaign brief to be generated. Any legacy dept briefs remain
  read only"* — ADR-0104 d.1–d.2)
  (`promote_single_job`, from before ADR-0100). Nothing waits on it — the gate is the owner's task list — so it is a
  leftover that writes an unapproved, empty legacy row.
- [x] `I57.42` **Found 25 Sep (the walk's Arabic screens): 26 Arabic plurals have no dual (`_two`) form** — e.g.
  `workstreams.holds`, so a workstream holding two pieces reads "deliverables 2" in English, reversed. i18next falls back
  to the English `_other`. The RTL leak check looks for raw keys and cannot see this. Add `_two` (and `_few`/`_many`
  where the count is printed) to each, and a unit test that every Arabic `_one`/`_other` pair has a `_two`.
- [x] `I57.16` **CG-04, the piece drawer** (Edward, 24 Sep): opened from every view. "The whole story" IS
  the piece's task list — each task with its assignee, status and date; no extra block; the top line
  names the owner, not one person "with" it. Assigning stays on /schedule.
- [x] `I57.17` **Found 24 Sep, not caused by I57: `g-full-campaign.spec.ts` G1a expects the old wording.** It
  looks for "2 deliverable dates filled"; `b829113` (flows-22-sep) changed the wizard's note to "2 dates
  filled from the go-live date." A test change only — the regex follows the copy.
- [x] `I57.15` **Found 24 Sep, not caused by I57: a flaky step in `coverage/campaign-phases.spec.ts:495`**
  ("a rename reaches the tasks"). It reads the tasks `order=sort_order`, and two "Create Artwork"
  units share a `sort_order`, so the database may return them either way round — failed once, passed on
  the re-run. Fix: order by `sort_order, unit_index` (or `id`) in the assertion — a test change only.
**Built 24 Sep in parallel (five workers, joined and run whole):** CG-04 drawer, CG-02 Season map,
CG-07 Brief, CG-05 Board, CG-06 Timeline, CG-03 Where is everything, CG-E1 Edit; the hours-vs-booked
check; the dashboard and Team "At risk" tiles. Every view shows the piece and its OWNER; the drawer
breaks it down by task (Edward). **Choices made while building — Edward to confirm:**
1. **Waiting** (the frames' Blocked) is sky blue (`--hue-2`) on the Board, Timeline, Season map and
   Where is everything; Unassigned on the Board is rust — red is LATE only.
2. **Approved shows as Approved** (Edward, 24 Sep: the internal approval, shown as such — light green,
   an Approved column on the Board, a step in Edit); the client's approval is added when that exists.
3. **Where is everything:** "With whom" is the owner · department; "Next" names the owner's step;
   finished pieces sort to the bottom; the clock is late / at risk / waiting / on time.
4. **Edit (CG-E1):** priority is read-only (nothing writes it after the brief); the due date changes
   only through the evidenced dialog after approval and is read-only before; Close always asks first.
   **A new owner moves the department** (ADR-0102, accepted 24 Sep — superseding ADR-0099 d.2/d.3):
   the dialog says where it will move before saving. Migration `20260924160000` (local only), pgTAP 156;
   suites 060/061/062/067/107/140/150/152 rewritten to the new rule.
5. **Brief (CG-07):** the budget is hidden without `campaign_budget:view` (as in the wizard); no
   "approved by" name (not stored); section 5 (dos and don'ts) and "uploaded from" have no data yet.
6. **Hours check (I57.12):** booked hours are the assignee's bookings ON THAT TASK; a task never
   scheduled is judged by the date checks only.
7. **Not built from the frames:** the drawer's Nudge / Request a change / Escalate and its Files
   (Files are one press away on Deliverables).
**Still stale:** `walks/job-to-campaign.walk.spec.ts` (department tabs, department briefs, the old
phase select) and the phases guide's screenshots — to be rewritten as review artefacts.

**Deferred on purpose:** change requests after work started (CG-E2); setting a stage by hand or by
dragging (needs an ADR); editing a grid cell in place; "escalates in 4h" on the clock (the SLA
engine); a real "from the client" signal (the portal).

### I56 — The campaign aligned to the v3 Figma, section C (22 Sep, Edward)

> Edward, 22 Sep: *"the next step is aligning C — Campaign — Many Deliverables Many Departments…
> this is an alignment exercise, we are updating the UI and only the necessary changes to
> accommodate the updated UI."* The Figma section is `C · CAMPAIGN — MANY DELIVERABLES, MANY
> DEPARTMENTS` (node `1570:41`): CB-v3-01 The campaign, 02 The campaign brief, 02b Proposed from the
> brief, 03 The work, 04 Timing, 05 Review and approve, and the dialogs P1 Add a phase, P2 Add a
> rule, P3 New workstream, P4 Add a piece, P5 Workstream detail, P6 Remove a piece, P7 Move a piece,
> P8 Edit a piece. Fifteen questions were answered one at a time on 22 Sep; each item below names the
> answer it comes from. Three went to the designer and were answered the same evening: the campaign
> brief is ALWAYS the Creative Brief (`360`, 17 fields) with no picker; the rail layout of CB-v3-02
> is the one to build; "Campaign (optional)" is not required on the single job and stays removed.

**Two decisions come before any code (`maestro-adr`):**

- [x] `I56.1` ~~⚠️~~ **ADR-0099 accepted, 23 Sep — a campaign's work MAY be grouped into
  workstreams.** Edward, 23 Sep: *"the Workstream is meant to be an optional grouping… some campaigns
  and single jobs may not require it"* — which rewrote the draft rather than trimming it. A piece
  taking its department FROM its group would have none when ungrouped, so
  `deliverables.department_id` stays authoritative and becomes **chosen**, never stamped from the
  owner (supersedes ADR-0050 d.2 for deliverables; `sub_tasks` untouched). The group carries a
  required department and an owner starting on the department's lead, and **filling the department in
  is what the group does**: adding or moving a piece sets it, taking a piece out changes only the
  grouping. Existing campaigns are NOT grouped; a single job has none. **The sharp edge**: every
  create path must now refuse to save a piece with no department, or it is invisible to the people
  who should act on it — part of the work, not a follow-up. Edward: *"accept and we see how it looks
  in practice."*
- [x] `I56.2` ~~⚠️~~ **ADR-0100 accepted, 23 Sep — a campaign has ONE brief, and the deliverable's
  owner approves the task list as the second gate.** The draft proposed campaign approval as the ONLY
  gate; Edward rejected that: *"The assigned deliverables owner has to review and approve the tasks
  before the tasks can be assigned. This is now the second gate."* That is ADR-0090's single-job gate
  extended to all work, which deletes the `kind` fork in `deliverable_work_acceptance_refusal`.
  **The approval surface does not change shape** — one page per department, review everything,
  approve all or selected. Owners are one or two people per department, so the same people do the
  same single pass; approval simply attaches to task lists instead of a brief, and can be partial.
  *(The draft claimed this multiplied approvals one-per-deliverable and called it a real cost. It
  was wrong — it assumed a different owner per deliverable — and the correction is recorded in the
  ADR so it is not re-derived.)* The 216 existing department briefs are kept and set aside; work
  already running is exempt by date rather than stamped approved-by-nobody;
  `deliverables.owner_user_id` becomes NOT NULL (`I22.5` decided that on 28 Aug and it was built as
  a screen rule only — Edward, 23 Sep: *"this is now the second time I have had to mention this"*).
  Vocabulary settled: **deliverable**, not "piece" — *"it is cosmetic and the label can be changed
  if required."* Original entry:
- [ ] ~~`I56.2`~~ **ADR — a campaign has ONE brief and no department briefs** (Edward, 22 Sep, from the
  designer: *"no department level briefs required… one brief fits all on a campaign brief"*).
  **This reverses ADR-0072** and removes a GATE: ADR-0072 d.6 refuses assignment until the
  deliverable's department has approved its brief, and `my_pending_approvals` lists an unwritten
  department brief as owed (`I53.22`). The ADR must say what replaces the gate — the campaign's own
  approval, presumably. **What becomes of campaigns on production that already carry department
  briefs is ANSWERED: keep them and set them aside** — the brief stays on the record, it no longer
  gates anything and is never asked for again (Edward, 23 Sep). Until the ADR is accepted, nothing
  here is built.

**Both ADRs are accepted (ADR-0099, ADR-0100), so `I56.3`–`I56.13` are UN-GATED as of 23 Sep.**
They carry the two decisions with them: a deliverable's department is its own and chosen (never
stamped from the owner), grouping is optional, and the second gate is the owner's task-list
approval on a page that approves all or selected.

- [x] `I56.F` **The foundation for section C — built 23 Sep** (migrations `20260923140000`–`200000`,
  local only). Everything `I56.3`–`I56.13` reads, landed first and alone because a half-migrated
  state would refuse assignments for reasons nobody could see.
  — **`workstreams`**: optional named groups, required department, owner starting on the
    department's lead, unique per campaign (case-insensitively), deleting one that holds work
    refused; `deliverables.workstream_id` nullable.
  — **A deliverable's department is its own.** The group sets it on joining or moving; the owner
    supplies a default once at creation; **nothing restamps it afterwards**. The 22 Sep fault
    (`I53.29`) closed at the root.
  — **An owner is required when work is created**, and neither owner nor department can be taken
    away. `I22.5` decided this on 28 Aug and it had been a screen rule ever since.
  — **The second gate is the owner accepting the task list**, for campaigns as well as single jobs;
    `deliverable_work_acceptance_refusal` lost its `kind` fork. Campaigns approved before
    `app_settings.task_list_gate_from` are exempt, so nothing running stopped.
  — **"Waiting for you" follows it**: department briefs out, task lists in.
  — **The screen**: `TaskListsApproval` on the department tab replaces `BriefApproval` — one page,
    review everything, **approve all or selected**, a row per deliverable saying whose it is and
    where it stands. A lead may still accept for their whole department (ADR-0090 d.4), which is
    what keeps it one sitting.
  **Two tests were retired with the feature** (`133`, `137`: the department-brief gate and the
  unwritten-brief ask) — Edward, 23 Sep, option 1. **Twenty-six suites were rewritten to the new
  rules**, not made to pass: each obsolete assertion now states what replaced it and why.
  **Green:** 148 database files / 1,820 tests · 2,414 unit · 100 browser · typecheck, lint,
  licences, authz and the browser-coverage gate.
  **Two things found and deliberately not changed — Edward's call:**
  (1) `ADR-0053 d.5` still moves a person's live work when THEY change department
  (`app.tg_user_department_restamp`). ADR-0099 superseded only the owner-derivation on the
  deliverable. It is the same shape of surprise and may want the same treatment.
  (2) `140_a_deliverables_unassigned_tasks_follow_its_owner.sql` is now misnamed — tasks follow the
  DEPARTMENT, not the owner. Left for a rename of its own.

**Then, in build order:**

- [x] `I56.3` **Workstreams on the work screen — done 23 Sep** (migrations `20260923210000`,
  `20260923220000`; pgTAP 150; `WorkstreamsPanel` + its 10 unit tests; `coverage/workstreams.spec.ts`,
  5 browser tests). On the campaign's **All deliverables** tab, not inside a department's: a
  workstream belongs to the campaign and may be the only place two departments' work is seen side
  by side. Make a group, rename or re-own one, move a deliverable between groups or out of all of
  them, remove an empty one — each an RPC, because each carries a rule the screen must not be
  trusted to keep. A campaign with no groups says so in one line and is not nagged: grouping is
  optional (d.1).
  **Two bugs in the first cut, found by the pgTAP suite and not by reading.** Both triggers were
  column-restricted — `before insert or update OF owner_user_id` and `after update OF
  owner_user_id, department_id` — and the move RPC writes only `workstream_id`. A column-restricted
  trigger does not fire for a statement that does not name its column, so **moving work between
  groups silently did nothing at all**: it joined the group and kept its old department, and its
  tasks followed the department that never changed. `20260922110000` had already written this exact
  trap down in its own header. Both column lists widened; proved before and after.
  Also: the duplicate-name refusal quoted the name just TYPED rather than the group already there
  — *"already has a workstream called 'always-on'"* when the one in the way is *"Always-on"*.
  **Not in this item** (they are `I56.4` and later): the model proposing the grouping, the code per
  deliverable, and review grouped by workstream.
- [x] `I56.4` **The model proposes the grouping (CB-v3-02b) — ADR-0101 accepted and BUILT 24 Sep** (adds: the AM names each group's owner from department leads, team leads and deputies, reassignable; enforced where a workstream is written). Built: `generate-deliverables` returns groups (name, department by NAME from the caller-read list, pieces with `from`), `sanitizeProposal` maps departments to ids and drops unknown ones; `ProposalStep` is the second screen of step 2 (keep/drop per piece, Keep all · Drop all · + Add per group, + New workstream, owner picker, *Keep these — go to the work*, Back, Cancel); a list somebody already built skips it; migration `20260924130000` (trigger `workstream_owner_is_a_lead`, pgTAP 154; test 152's group owner is now a lead) — applied to the local database 24 Sep (Edward). Walked on the local stack with a real model answer. The work step's amber "N deliverables proposed" box is removed (Edward, 24 Sep); ADR-0097 d.5's "how many need a choice" is now said on the proposal screen's status line, and each row still flags itself. Step 3 carries "1 pieces across 1 workstreams" — pluralisation, for Edward's step 3 walk. The e2e specs `coverage/campaign-phases.spec.ts` and `guides/campaign-phases-guide.spec.ts` still look for `wizard-proposed-note`. The proposal returns named groups with a
  department as well as pieces, each piece saying which line of the brief it came from; Keep all /
  Drop all per group; nothing exists until kept (the ADR-0048 d.4 rule). Names come from the brief's
  own words — short, no department word, unique in the campaign, always editable; no sensible name
  falls back to the department's. ADR-0097 addendum: the catalogue-only rule is unchanged, only the
  shape of what comes back grows. `+ New workstream` sits beside the proposals and on the work screen.
- [ ] `I56.5` **The campaign brief (CB-v3-02).** Always `360` Creative Brief, 17 fields, no picker.
  The rail layout: numbered parts, filled counts per part, drop zone, dos and don'ts, attachments —
  the single job's brief screen, reused. **Each template field names its part** (Q7): a section on the
  field, edited in Admin → Brief templates beside the Essential tick; the screen draws whatever parts
  the template names, in order. A template naming none shows one list.
- [ ] `I56.6` **Campaign rules on top of the client's (P2).** The campaign brief carries its own dos
  and don'ts; a piece inherits the client's (locked, from the profile — Edward, 22 Sep) plus the
  campaign's, each marked with where it came from. A campaign rule can be added, edited and removed;
  a client rule can only be read. Optional per rule: which languages it applies in, and a "because".
- [ ] `I56.7` **Language.** A new `language` attribute list beside channel/format/orientation
  (`deliverable_attribute_values`), seeded Arabic / English / Kurdish with both names; Admin →
  Deliverable types gains it in the picker. **One language per piece** (`deliverables.language`). A
  language needing its own owner or status is its own piece, using the catalogue's `CNT-022
  Translation` / `VID-022 Video Adaptation` — said in one line on the piece panel.
- [ ] `I56.8` **A piece's own fields (P4, P8).** The deliverable from the catalogue is REQUIRED and is
  a typed search (it brings the task list); the name is what it is called on lists; **"the idea"** is
  a new optional line — *"the line the creative reads first"*; plus format, channel, priority, phase,
  workstream, language.
- [ ] `I56.9` **A code per piece (Q10).** Letters from the workstream plus a number counting up within
  it; generated on creation; **never changes** on rename or on a move to another workstream; unique
  within the campaign; shown on the work, timing and review screens, and searchable.
- [x] ~~`I56.10`~~ **SUPERSEDED 24 Sep (Edward, `dca52e7`: "a phase is a start and an end date; the event is gone").** Was: **A phase ends on an event (P1).** `campaign_phases` gains the event it ends on; the
  start is filled from the previous phase's end and stays editable; the event is named on the timing
  strip and in every piece's date explanation. **No piece is created automatically** by adding a phase
  (Edward: *"add pieces as required"*).
- [x] `I56.11` **Timing (CB-v3-04, P7).** Dates are COUNTED BACK, not typed: a piece's date comes from
  its phase's end using the tenant's run-up (delivery 2 days before — a GAP, counted exclusively —
  then the piece's own working days of work back from there, COUNTING THE DUE DAY (Edward, 24 Sep:
  "it needs four days" means four days of work ending on the day it is due). One function does both
  count-backs for the whole product — `startFromDue` in `lib/campaigns/go-live-dates.ts`, which
  `lib/timing/plan-back.ts` re-exports; `datesFromGoLive` and the single job's strip used to count
  exclusively and disagreed with the timing screen by a day. Dates already stored on live rows are
  not recalculated. A piece can be pulled earlier, never later than
  its phase. Moving a phase's end re-plans everything in it. A piece short of its run-up is amber, in
  the single job's words, and goes out tagged reduced scope. **"Given to client" is a MARKER only**
  (Q4) — no second date, no evidence yet. Each row shows its DEPARTMENT's load for the due week (Q14),
  never a person. The lead-time warning lives here and nowhere else (Q12); "split it into its own
  campaign" is not built.
  **Built 24 Sep to the frame, with the Edit it lacked** (Edward: *"the designer did not include an
  edit button in the event that dates need to be changed"*). A pencil on every phase block opens the
  name/start/end dialog; an **Edit** on every row (where the frame put MOVE) opens the piece's date,
  the start counted back from it and "given to the client". **A date chooses the phase — earlier OR
  later** (Edward: *"Move it to that phase"*); a day in no phase is refused, naming the ranges; a
  phase edit that overlaps the next pushes it clear and says so, and pieces with their own dates
  follow the new ranges (ADR-0096 addendum, 24 Sep). The strip is one violet family; the event
  wording and the phase-end date box are gone; Due was mis-aligned under Starts (the action column
  was `auto`) and is fixed; the capacity column reads the department's week
  (`DepartmentWeekLoad`); Needs reads the type's lead time where the catalogue has one; "given to
  client" is stored (`deliverables.is_given_to_client`, `20260924140000`, pgTAP 155). Without phases
  it is the same rows and dialog as one list, with the go-live optional at the top. Button: *Next —
  review*. `MovePieceDialog` and `movePieceOptions` are gone — the date does the moving.
- [x] `I56.12` **Review and approve (CB-v3-05).** Grouped by workstream — *Design & Animation ·
  Creative · 21 pieces · Fadia assigns*; the facts strip (pieces, launch, finale, languages, rules);
  "what approving does" in the words the frame uses; Save as a draft.
  **24 Sep:** *This one is yours to approve*, the frame's lede, *Approve and start the work*; "what
  approving does" now says each owner is told and approves their task lists before anyone is
  assigned (ADR-0100 d.2 — the `campaign_approved` mail already said so). Without workstreams "who
  gets what" lists the OWNERS, one row each, rather than one "Not in a workstream" row naming
  nobody. The step-5 notice about department brief templates is gone with the department brief (its
  text key did not even exist in `en.json`).
- [x] `I56.14` **A piece joining another campaign takes that campaign's numbering.** Found 24 Sep by
  pgTAP `106`, which died on `duplicate key value violates unique constraint
  "uq_deliverables_campaign_code"`. `I56.9`'s code is stamped on insert and unique per campaign
  (`stream_id`, `code`), but `attach_job_to_campaign` moves a draft job's rows onto the campaign it
  duplicates — and `WS-001`, the fallback for ungrouped work, is the first code almost every
  campaign issues, so two campaigns meeting is the ordinary case rather than the unlucky one.
  "Never changes" means never WITHIN its campaign; the number is re-issued when the campaign
  changes, keeping the letters. `20260924092000`, pgTAP `151`.
- [x] `I56.15` **Moving work between workstreams is reachable again.** The move has existed since
  22 Sep (`move_deliverable_to_workstream`, `useMoveDeliverableToWorkstream`), but the only screen
  exposing it was `WorkstreamsPanel` — the campaign-page panel `CB-v3-03` replaces. A **Move**
  action on the piece row opens `MoveToWorkstreamDialog`, built as a sibling of `CB-v3-P7`'s move
  between phases so the two read as one act. It says the consequence the list cannot: the piece
  takes the new group's department and its unassigned tasks follow, while committed work stays.
  `WorkstreamsPanel` is not deleted until this ships.
- [ ] `I56.16` **An owner is required on every piece.** Edward, 22 and 23 Sep. It was not that the
  field was missing — it was that nothing enforced it: `filledDeliverables` filtered a row with no
  owner out of the count, so the step passed while leaving pieces nobody was named on, silently.
  The deliverable owner approving the task list (ADR-0100) is that person, so an unowned piece has
  no second gate. Next now refuses and names the gap. Wizard side done; the submit path and the
  proposal's default owner are still open.
- [ ] `I56.17` **`.brief-filled-mark` is declared twice in `src/index.css`.** The second wins, so the
  designed violet pill has not rendered since it was added, and a RESERVED status colour (amber) was
  being spent on something that is not a status. The duplicate is removed; the pill is the treatment.
  Found 24 Sep while joining `CB-v3-02`.
- [x] `I56.18` **SIGNED OFF 27 Sep (Edward: "consider campaign screens signed off"; minor edits he will name one by one).** Was: **The five campaign screens do not match the `CB-v3` frames.** Edward, 24 Sep — he
  walks them page by page and his list governs; the findings in `docs/memory/sessions/2026-09-24.md`
  are a starting point, not the plan. One cause repeated: the new screens were dropped inside the OLD
  wizard chrome. Known so far: the "Campaign Builder" header and `STEP n OF 5` tag should not exist
  (the frames have a topbar breadcrumb and "Saved as a draft"); steps 3 and 4 are wrapped in a titled
  `Panel` the frames do not have; step 1 is headed *"Set the season up"* with Client+Brand on one row
  and **the phases as the right-hand column with no toggle**, and has neither the "Evidence" nor the
  "Brand documents" panel; step 4 opens on a go-live field and a floating "Add a phase"; the season
  strip is a violet ramp, not the categorical hues; every Next names its destination; step 5 is headed
  *"This one is yours to approve"*. Step 5's body already matches. **Read the frame's screenshot beside
  the walk's, one at a time** — building from the task text alone is what produced this.
  - [x] **Step 1, Edward's list (24 Sep)** — his list overrides the findings above: the "Evidence" and
    "Brand documents" panels STAY and the phases toggle stays. Done: an (i) beside "Evidence the brief
    was requested" whose hover tip (`SJ-v3-01b`, `components/InfoTip.tsx`) replaces the amber notice;
    the phases panel sits under Brand documents; Next reads "Next – The brief"; phases on with none
    added refuses with *"This campaign requires phases. Please add phases or switch phases off."*;
    **a phase is a start date and an end date — the event is gone** from the dialog, the panel and
    the wording (the draft's `eventName` is kept only so old drafts load, and cleared on edit);
    responsive — the wizard's columns follow its own width (container query), nothing scrolls
    sideways at 900 or 390. Step 4 still says "Ends on {{event}}" / "the phase's event" and now
    falls back to the date — to fix when Edward walks step 4.
  - [x] **Step 2, Edward's list (24 Sep).** One drop zone and it reads: the compact ingest control
    replaces the frame's dead drop zone (it called an empty function) and the right-hand "Fill from
    a brief document" panel; "Paste text instead" kept inside it. "Campaign reference materials" is
    a line under it, "Add reference files", folders only when opened. Full width. Sections regrouped
    by why → who → what we say → where and how measured: 3 **The idea** (insight, proposition), 4
    **Journey and measures** (objective, target audience, geography, platforms, budget). **The budget
    shows only to `campaign_budget:view`** — Power Admin, Account Director, Account Manager, Traffic
    Manager, and whichever role Admin → Roles gives it to (the Finance lead's); migration
    `20260924120000`, pgTAP 153. Hidden on screen only (Edward's choice) — not a lock on
    `campaigns.brief`; the fill count and the filled-marker strip skip it too. Next reads "Next —
    propose the deliverables"; Back and Cancel stay; the step's own foot note. Audience primary and
    secondary full width.
    **Second pass (Edward, 24 Sep):** (1) *standing advice is never an amber box* — app-wide, advice
    only: the filing hints (Brand documents, Reference files, the single job's Attachments) and the
    single job's evidence note are (i) tips now; boxes that report a state or a result stay. (2) An
    uploaded brief marks each field it filled ON the field — "from the uploaded brief" and its own
    Keep — and the strip at the top is gone; editing the field clears the mark too.
    (3) **Next is refused while any such field is unchecked** (ADR-0044, "the result is always
    reviewed"; Edward chose refuse over "Keep all", 24 Sep): the pop-up names every one, and closing it
    lands on the first. A budget the person cannot see never holds them up.
- [ ] `I56.20` **A failed upload blames a grant it may not be.** Found 24 Sep on step 2: filing the
  brief document failed with *"You may not hold the Assets grant"* for an account manager who holds
  it — the real cause was `asset-url` answering `503 storage_unconfigured` (the local stack's server
  functions have no B2 storage keys). The message should say what actually failed. And the drop
  zone says *"luma-brief.txt is filed in the campaign's References"* as soon as the file is read —
  before, and whether or not, the filing succeeds. Local B2 config is Edward's to restore; both
  wordings are code fixes, not yet asked for.
- [x] `I56.21` **Three dialogs ran their content flush against the modal's edge** — found by Edward
  24 Sep on CB-v3-02b: the piece dialog (Add and Edit), New workstream and Remove a piece lay out
  their own content instead of the Modal's padded `.modal-body`, so every field and button touched
  the border. They carry the same padding and scroll now. Also: Remove a piece's amber "if work had
  started" panel is an (i) beside its title (Edward's rule); inside a dialog a tip anchors to the
  title so the dialog cannot clip it; and the Modal never gives its first focus to an (i) — doing so
  opened the tip over the dialog as it appeared. Walked at desktop and phone with a hard check that
  nothing inside a dialog sits within 12px of its edge.
  **Then (Edward, same day): the piece dialog opened with Save/Cancel sliced by its bottom edge** on a
  laptop-height screen. The button row is pinned to the bottom of all three dialogs now, the fields
  scrolling behind it; the walk asserts every button is fully visible the moment a dialog opens.
- [x] `I56.22` **CB-v3-02b merged into step 3, and workstreams are a switch** (Edward, 24 Sep). The
  proposal lands on The work — *"2b should be step 3 the work and the button should read Keep these
  - go to timing"* — one screen, not the same list reviewed twice (ADR-0101 d.6 amended). Proposed
  pieces carry the tick, their brief line and PROPOSED; the person's own pieces are plain work with
  a remove; each group keeps the quick-add line, Move, and **Open** for the workstream drawer
  (`CB-v3-P5`, restored after I removed it without asking). *Keep these — go to timing* drops the
  unticked pieces and empty proposed groups, then asks for owners, types and departments. The old
  step 3 component `TheWorkStep` is deleted (replaced). **Workstreams switch** on step 1 beside
  Phases, on by default (ADR-0101 d.9): off asks the model for pieces only and shows one plain list.
  Found and fixed on the walk: the piece dialog's hidden fields (Phase with no phases, Workstream
  with workstreams off) still showed — `.field`'s `display:flex` beat `hidden`; the drawer floated
  mid-screen instead of full height; the drawer and the move dialog counted dropped pieces; the add
  dialog said "add on a workstream" with workstreams off; "1 pieces" in the drawer and the switch's
  refusal. Walked in both states — with and without workstreams — at desktop, tablet and phone.
- [ ] `I56.23` **Arabic plurals fall back to English across the app.** Found 24 Sep: the Arabic
  locale carries only `_one` / `_other` for every plural string, and Arabic has six forms, so a count
  of 0, 2, 3–10 or 11–99 finds no Arabic key and `fallbackLng: 'en'` shows ENGLISH on an Arabic screen
  (e.g. `work.pieces` with 3 → "3 pieces"). The parity test now allows the extra Arabic forms
  (`_zero/_two/_few/_many`); the two strings added 24 Sep carry all six. Every other plural string in
  `ar.json` still needs its four missing forms. Related English slips seen on the way: step 5's
  `approve.lede` and the unused `work.summary` say "{{pieces}} pieces" with no plural.
- [x] `I56.24` **The wizard never sent the workstreams — or a piece's idea, notes, language, priority.**
  Found 24 Sep while wiring the task-list approval: `write_campaign_content` has taken
  `p_workstreams` and each piece's `workstreamKey`/`contentIdea`/`notes`/`language`/`priority` since
  `20260924100000`, and the wizard's submit passed none of them — a campaign laid out in five
  workstreams came out with none, so the owners' task lists had nothing to group by. The draft save
  dropped the same fields, so a resumed draft lost its groups. Both carry them now (and "given to
  client"); a Vitest walk holds the payload.
- [x] `I56.25` **A date typed on a Friday was shown as the Thursday and submitted as the Friday.**
  Found 24 Sep: step 4 prints a piece's date on the working day before a rest day, and the submit
  sent the raw typed day (`d.dueAt ?? planned`). What the row shows is what goes up now — the plan's
  date with phases, the working day and its counted-back start without.
- [x] `I56.26` **A failed browser run left the tenant's delivery rule at 3.** M1 sets 3 and put 2
  back as its last line, so any failure above it left every later date a day early (seen 24 Sep: the
  timing screen said Tue where Wed was right). The reset is an `afterEach` now.
- [x] `I56.27` **The task lists to approve, in the wizard's look** (Edward, 24 Sep: *"the approve
  tasks for each deliverable … needs to follow the same style"*). The department tab's second gate
  (ADR-0100 d.2) is grouped by workstream like The work, each row a tick, its code and name, its owner
  and the task list itself one press away with each task's hours; Approve all mine / Approve
  selected. The department-brief controls are gone from the tab and the page — Generate, the template
  choice, the "no brief yet" amber boxes, the "departments owe a brief" list — and the tab dot now
  marks task lists waiting (Edward: *"retain the legacy data, but brief controls can be removed"*). A
  campaign's existing department brief is still shown, read only; a SINGLE JOB's brief (its only
  one, ADR-0084) keeps its edit. The tab is headed with the department's name alone.
- [x] `I56.29` **Four defects the 24 Sep walk found on these screens.** (1) Step 5 scrolled sideways
  by 207px on a phone — the card header's chips never wrapped; at tablet width the stacked cards
  stopped short of the full width. (2) The department tab's deliverables table scrolled sideways
  by 204px on a phone; it stacks now, like the all-deliverables tab. (3) Approving one task list
  reshuffled the page — pieces created in one statement share `created_at`; the read orders by `id`
  after it and the task lists by code. (4) Without phases, step 5's Finale (the last due date) fell
  BEFORE its Launch (the go-live); the finale is now the latest of the two. Also: the timing
  screen's Arabic counts carry all six plural forms (`I56.23` for the rest of the app).
- [x] `I56.28` **Concepts on a new campaign have nowhere to hang.** ADR-0065's *Propose concepts*
  hangs off the department brief and is drawn only where one exists. With the department brief
  retired (`I56.27`), a campaign created from now on never shows it. A single job still does. **Where
  concepts should live on a campaign is Edward's call** — not decided here.
  **Decided 24 Sep** (Edward: *"remove for now.. do not remove the code, just leave it off the
  page"*): the panel is off the campaign page behind `SHOW_CONCEPTS`; `ConceptsPanel`, its api and
  its tests are kept. Section N's walk is parked (`describe.skip`) with one live test that the panel
  stays off. Bringing concepts back is its own item when it is decided where they live.
- [x] `I56.31` **What the full walkthrough found (24 Sep), fixed.** (1) A refused Next left its red
  "Required before continuing" marks on fields after they were filled — they now clear as each is
  filled. (2) Step 3 and step 4 refused with "an owner / a due date on every piece" — they now NAME
  the pieces (Edward: "Refuse and name them"). (3) The evidence panel's "These details are correct"
  tick sat alone above its label, with its note as a large paragraph — one line now, the note in an
  (i). (4) An (i) low on the screen opened its tip off the bottom of the window — it opens above.
  (5) The read-brief mark said "from the uploaded brief" for a pasted one — "from the brief". (6) The
  workstream owner chip cut "Dev Content Lead · Content" short. (7) On a phone, a piece row pushed its
  × onto a line of its own. (8) Step 5's Arabic counts (clocks, leads, hours, chips) and the phase
  rings' "1 deliverables" fell back to English / wrong plural — all six Arabic forms now. (9) The campaigns list's
  search box had no style. (10) Step 4 said "1 already had dates and were left alone" — singular
  and plural now, both languages. (11) On a phone the timing rows stacked their dates with no
  labels — each says Needs / Starts / Due.
- [x] `I56.32` **Task lists, not department briefs, in what is left (Edward, 24 Sep).** (1) The
  campaigns list's "Department briefs" column is "Task lists": `2 of 3 waiting` / `3 of 3 approved`,
  "After approval" while the campaign is not yet approved, "No pieces yet" with none. (2) The
  approval email and its inbox line say "review the task list of each" — no brief (*"only task
  lists"*). (3) Step 2's lede said "in four parts" over five sections — "five parts".
- [x] `I56.30` **Capacity in the frame's colours** (Edward, 24 Sep: *"follow the frame colors"*):
  "nothing booked" is amber, as `CB-v3-04` draws it — only a light, booked week is green.
- [x] `I56.19` **16 new controls have no browser test (the proposal screen's added four; the (i) button, the phase dialog's start date and step 2's "Add reference files" are among them) — `check:e2e-coverage` fails on the branch.**
  The `CB-v3` components built 23–24 Sep: the piece dialog's languages, Add another and workstream
  box; the phase dialog's Remove and Starts; the rule dialog's locales; the move dialog's options and
  its "out of any workstream"; the brief's drop zone; the work step's Add and group name; timing's
  Given to client, phase end and Place. The walk presses most of them, but through
  `locator('[data-testid^=…]')`, which the gate's scanner cannot see — it counts `getByTestId` only.
  **Whether to cover them now or with `I56.18`'s rebuild is Edward's call**; the ids move if the
  screens are rebuilt.
- [ ] `I56.13` **The walk and the guide.** A `WALK=1` walk of the whole campaign flow writing an HTML
  report with embedded screenshots (the `I54.17` pattern), and guide `02-creating-a-campaign.md`
  re-shot and rewritten in the same session.

**Deferred on purpose, each to its own decision:** per-department run-up times (Edward: *"leave at
tenant default for now, we will refine timings later"*); per-type lead times in the catalogue (all 257
active entries carry a task list and NONE carries a lead time); the full promised-date-with-evidence
version of "given to client" (ADR-0088 d.7a, `I46.1`); change requests after approval with the hours
already spent; a master piece that knows its adaptations.

### I54 — The single job reformatted to the v3 Figma, one screen at a time (22 Sep, Edward)

> Edward, 22 Sep: *"yet again we have been asked to reformat the flows… the figma is what needs to
> be implemented, in implementing this change we need to ensure we do not break functionality or
> existing features… if something is missing it is included."* The Figma section is
> `B · SINGLE JOB — BRIEF FIRST` (node `1570:7`): four steps — **Type of brief → The brief → Who and
> when → Review and open** — plus three side panels (S1 similar job, S2 under the lead time, S4 add a
> brand). Read from node text, never screenshots (traps.md). Each screen is built, reviewed by Edward
> on the local stack, then the next — **in the Figma's ORDER from the start** (Edward, 22 Sep, on
> seeing the old request screen at step 2: *"what the hell… step 2 of the brief looks nothing like
> the figma"*): 1 Type of brief (with the evidence and the client's words) → 2 The brief → 3 Who and
> when (today's request screen: title, what is needed, due date, department — its own turn comes) →
> 4 Review. **The draft is created on the first Next**, under a provisional name (client · template
> · second · suffix; retried once on a clash), so the receipt files and the brief autosaves into the
> draft (`campaigns.brief.briefValues`) until the department is known; the `campaign_briefs` row is
> written on Next from 3. **Migration `20260922140000`:** a campaign's Library folder now follows a
> rename (it never did — the provisional name would have stuck on every job's folder); pgTAP 143.
>
> **Departures from accepted ADRs the later screens will raise, one per screen when its turn comes**
> (none decided yet except the first): ~~no step of its own for "how the request came in"~~ **decided
> 22 Sep — the evidence (who asked, how it arrived, the receipt) sits on screen 1 beside "For whom",
> the receipt path reused whole (ADR-0066 unchanged; the Figma's "never read" does not apply)**; a
> "Campaign (optional)" on a single job (ADR-0083 d.3); prefill and a
> locked dos-and-don'ts block from the client profile (ADR-0084 says nothing prefills); priority, a
> lead-time count-back and a 24-hour escalation to a *traffic manager* (no such role); the similar-job
> check on step 3 with a % match and merge (ADR-0085 has it on Approve); a *Reduced scope* tag and
> client signature when the date is short; **Open** in place of Approve with post-release change
> tracking (ADR-0085).

- [x] `I54.1` **SJ-v3-01 · What are we making?** — built 22 Sep. New first step `BriefTypeStep`:
  client, brand (add-one in the list, SJ-A3), and the kind of brief picked from a card per template —
  **every active template with fields, from `brief_templates`** (Edward: *"we have 13 templates and
  the ability to add more, we need to make sure all available templates are displayed"*), the
  Execution brief first, the rest by name. Search narrows the grid; an empty match is one line.
  The card is a reusable component, `components/TemplateCard.tsx` (icon tile on a categorical hue,
  name EN + AR, description, department pill, field count, usage line; `aria-pressed` is the
  choice). Buttons are the one `Button` (I48.32). Tokens added to `index.css`: `--border-soft`,
  `--border-input`, `--text-faint`, `--accent-border`, `--accent-ink`, `--shadow-card`, and six
  categorical hue pairs `--hue-1…6` (never status). The step rail is now pills (the v3 stepper).
  The choice is stored as `request.briefType` in `campaigns.brief`. The client and brand LEFT the
  request step. The usage line reads the client's own `campaign_briefs` ("LUMA Season 2 · 3
  briefs"). **Same day, Edward: cards smaller (four across, 36px tile) and the evidence moved up —
  who asked, how it arrived and the receipt panel (`compact`) share the row with "For whom"; the
  response clock chip sits in the head.** The request step keeps the title, the words, what is
  needed, the due date and the department. Unit: `TemplateCard.test.tsx`, wizard suite (9 new);
  browser: B0 in `b-single-job-request.spec.ts`, B2/B4/B4b re-pointed; the helper and nine specs
  enter through screen 1.
- [x] `I54.2` **Migration `20260922130000`** — a tenant provisioned after 30 Aug had NO NAMES on its
  seeded templates (the seed inserts only fields; the 30 Aug backfill ran once), so locally every
  card read `social_calendar`. New seed step `app.seed_tenant_brief_template_names` fills
  `name_en/ar` and the new `description_en/ar` columns WHERE NULL for the twelve seeded keys, is
  called by the provisioning wrapper (reproduced whole), and backfills every tenant. pgTAP 142.
  **Not yet on production — Edward pushes.** Then `gen types --linked`.
- [x] `I54.3` **Admin → Brief templates edits a template's NAME and DESCRIPTION — done 23 Sep.**
  The screen wrote `fields` alone, so a template took its English name at creation and could never
  be renamed, had no Arabic name at all, and no description ever — and the description is the line
  each card reads out on screen 1 of the single job. The editor now carries four boxes (name and
  description, EN and AR), `useSaveBriefTemplate` patches only what it is handed (`undefined` leaves
  a column alone, an empty Arabic box stores NULL so the read still falls back to English), and the
  create form takes an Arabic name. **Every template may be renamed, the seeded twelve included**
  (Edward, 23 Sep): `brief_type`, the key a written brief stores itself under, is derived once at
  creation and is never touched here, which is what makes it safe. No migration — the columns
  arrived with `I54.2`. Five unit tests + the admin browser spec (which asserts the key did not
  move).
- [ ] `I54.4` **Thirty token values are in `index.css` but NOT in `E2EV1.pen`** — the pencil MCP was
  not connected in the 22 Sep session, and this line used to say six. It is **twelve** categorical
  hues each with its soft ground (24 values), the five support neutrals (`border-soft`,
  `border-input`, `text-faint`, `accent-border`, `accent-ink`) and `shadow-card`. Memory rule: new
  tokens go into both. **Every variable in the pen file carries a light AND a dark value; all thirty
  were written light-only — derive the dark values the same way the existing tokens were** (Edward,
  23 Sep). **Figma half:** the first six hues came from the section B frames and exist there as
  painted colours, not named styles; the other six were invented so all twelve brief cards get their
  own colour and are not in Figma at all. **The designer updates the Figma file himself — he has
  access to the pen file** (Edward, 23 Sep), so this task is the pen file only.
- [ ] `I54.5` **Arabic to the native reader (I18.8).** *Checked 23 Sep: none of it is MISSING.* All
  twelve templates carry an Arabic name and description (migration `20260922130000`), the Digital
  Build name included, and `src/locales/ar.json` has no untranslated or absent key — both files were
  compared whole. What is outstanding is a native speaker READING it, which is `I18.8` and is not
  something code can close. **The handover sheet is written:**
  `docs/reference/arabic-review-2026-09-23.md` — the twelve cards side by side with their English,
  the six that were written for this build marked ⭑, screen 1's interface, the priority words and
  the new Admin strings. Corrections come back as a migration (the template rows) plus a locale
  edit. **Edward: this needs a person, not a session.**
- [x] `I54.6` **SJ-v3-02 · The brief** — built 22 Sep. The brief is written from the template
  chosen on screen 1 (`BriefStep` was hard-wired to `single_execution`; the save, the read, the
  ingest and the deliverable's reminder read now carry / ignore the type). The page is titled after
  the template; a rail names its parts with counts — **1 · The essentials** (the FIRST FOUR fields,
  `splitBriefFields`; no template has an essentials flag), **2 · The rest** (+ "what could stop
  this", ADR-0084 d.8), **Dos and don'ts**, **Attachments** — anchors, not steps; the request's
  words stay under the rail (d.5). "Got a brief already? Drop it here" is `BriefIngestPanel`
  `compact`: a dropped or chosen file is read at once; paste keeps its button. **Autosaved**: a
  1.2 s debounce writes the brief the way Next does; "Saved" in the head. The required field is
  now PER TEMPLATE (`requiredBriefKeys`: The Task where the template has one, else its first field
  — the line ADR-0084 flagged as most likely to change). **Dos and don'ts inherits nothing** —
  nothing on a client, brand or campaign holds rules (ADR-0084 d.5); the section says so in one
  line; `I54.10` is the decision. Guidance is the field's placeholder. Unit: 4 new wizard tests,
  lib tests; browser: C1 extended (rail, counts, autosave), C4 re-worded. **Order fixed the same
  day** (see the section note): the brief is step 2, the words moved to screen 1, the helper and
  every single-job spec walk 1 → 2 → 3 → 4.
- [x] `I54.10` **The client rules ARE the dos and don'ts in the client profile** (Edward, 22 Sep) —
  built the same day. `clients.profile.rules` (jsonb, `{kind: do|dont, text}[]`; no migration),
  edited under Clients → the profile form (DO / DON'T pill + text per row). Screen 1's INHERITS line
  counts them; the brief page shows them LOCKED ("From Northwind Beverages. They travel with this
  piece; you cannot edit them here."); the review's *Rules it carries*; and they are SNAPSHOTTED
  into the brief values (`inheritedRules`) so the department reads what the AM saw — beside the
  task list (`TaskListApproval`). `lib/brief/rules.ts`. **From the client profile and nowhere else**
  — a "Campaign (optional)" field I had added to screen 1 to source rules from a campaign brief was
  NOT asked for and was removed the same day (Edward: *"at no point in the figma is there a drop
  down to select a campaign"*). Amends ADR-0084 d.5 ("nothing prefills") for rules only — an ADR
  addendum is owed.
- [x] `I54.11` ~~"The essentials" is the first four fields by position.~~ Superseded by `I54.14`
  the same day: a per-field flag, ticked in the admin editor.
- [x] `I54.7` **SJ-v3-04 · Who and when** — built 22 Sep (`WhoAndWhenStep`, replaces
  `RequestStep`). *Which team* as pills; the lead in a tinted row with "TEAM AT n%" (the due
  week's load, ADR-0083 d.10); no lead → team leads as owner (d.12) / nobody → the notice. *When*:
  the due date and **"Maestro counted it back for you"** — the working days the deliverable type
  needs (`deliverable_types.lead_time_hours` ÷ 8, else the tenant's 4) counted back over the Iraq
  week (`lib/lead-time.ts`), start · working · due · weekend cells. **Priority** High / Medium / Low
  — stored on the job's record (`campaigns.brief.request.priority`), shown on the review; NOT yet
  carried to tasks or My Work (`I54.12`). *What is being made* (title, type, quantity, channel,
  format) is a third card the Figma does not draw — its review card needs those values and the
  job needs its name. The Figma's "escalates to the traffic manager within 24 hours" is not built
  (no such role); the line says the lead assigns within their team.
- [x] `I54.8` **SJ-v3-05 · Review and open, S1 and S2** — built 22 Sep. Review: the deliverable card
  in the template's hue (1 DELIVERABLE · type · channel · Edit; quantity / due / format / goes to /
  starts / priority + REDUCED SCOPE), *How the request came in* (the words; who · source · arrival
  · proof), *The brief* (two columns), *This goes to* (hue-soft), *Rules it carries · LOCKED* (none
  on file — `I54.10`), *Attached* (the screenshot + the References folder's files). **S1 moved from
  Open to Next on who and when** (the Figma's step 3; ADR-0086 mechanics unchanged): CHECK THIS
  FIRST, the best match in amber with its %, *Add it to that job* / *Keep them separate*; the name
  opens the twin in a new tab (d.7 kept). **S2 · Under the lead time**: NOT A BLOCK — needs / has /
  short by, what reduced scope means, *Continue* (tags the job `reducedScope`) / *Give it more
  time*. The Figma's "the client signs" is not built; the tag is recorded. Open the job no longer
  runs the check. Unit: wizard suite (S2, S1-on-step-3, review), `SimilarJobsDialog.test`;
  browser: B8 (04 + S2), D1, E1/E1b re-pointed; every helper walks S1 on Next.
- [x] `I54.9` **S4 · Add a brand — CLOSED, nothing to build** (Edward, 23 Sep: *"on Brand - close
  it"*). The dialog already matches the frame (eyebrow, the four folders `provision_brand_folders`
  makes). The Figma's *short name* has no column and nothing wants one — the piece codes in section
  C take their letters from the workstream (`I56.9`), not from the brand.
- [x] `I54.13` **The flow wears the template's colour from screen 2** (Edward, 22 Sep: *"the color
  scheme should match the card"*): `data-hue` on the wizard → `--flow-hue`; the rail's current and
  done pills, the Next button, the brief page (title pill, active rail item, drop zone, the
  essentials' edge, filled fields, count pill, foot line), the team pills, the count-back strip
  and the review's deliverable card all take it. Screen 1 stays violet. **The active section is
  highlighted on the brief's rail** (IntersectionObserver + click).
- [x] `I54.14` **The essentials are the template's, not a count** (Edward: *"as per the
  concepts"*): `essential: true` on the field object in `brief_templates.fields`; migration
  `20260922150000` seeds the Figma's four for the six it draws and the authoring order for the
  rest, only where nothing is ticked; the wrapper calls it; **Admin → Brief templates gains an
  Essential tick per field**; `splitBriefFields` follows the ticks (first four only as a fallback
  for a template with none). pgTAP 144. Closes `I54.11`.
- [x] `I54.12` **Priority is on the deliverable** (Edward, 22 Sep: *"priorities need to be
  added"*): migration `20260922160000` — `deliverables.priority` (high / medium / low, CHECK), the
  one content writer re-emitted to carry it from the deliverable spec; `PriorityPill` on the
  deliverable's detail and the deliverables list. pgTAP 145. **Still to surface:** My Work rows and
  the schedule (`I54.15`).
- [x] `I54.15` **Priority on My Work, the schedule and the campaign page's deliverable rows — done
  23 Sep, as a SYMBOL.** Edward, 23 Sep: *"show as a symbol (exclamation icon for high priority)…
  use color coded symbols"* and *"change low to Normal"*. `PriorityPill` (a word in a pill) became
  `PriorityMark`: **high** an exclamation in the breach red, **medium** an up chevron in amber,
  **normal** a down chevron, quiet — alarm, up, down. Two new icons (`alert`, `chevron-up`). The
  two surfaces that already showed the WORD now show the same mark, so priority is read one way
  everywhere; the mark carries a `title` and a screen-reader label, so colour is never the only
  carrier. Reached by adding `priority` to the My Work select (`AssignedWorkItem`) and to the
  bookings select — which moved to `supabaseUntyped`, because `deliverables.priority` comes with
  `20260922160000` and is still local-only, so the generated types cannot see it (narrow it back
  after `gen types`). **On the grid, high and medium only**: normal is the common case and a mark
  on every chip would cost the width the label needs; the chip's tooltip still names all three.
  **Ordering** (`byDeadlineThenPriority`): the deadline leads and priority breaks the tie on the
  same DAY — the lists were not sorted at all before, so two tasks could swap places between
  reloads. "Low" is the WORD only; the stored value stays `low`, since renaming it means a
  migration, a CHECK constraint and every writer changed to alter something nothing else reads.
  The deliverables list keeps the sort it has (Edward, 23 Sep: the deliverables UI comes later).
  18 unit tests across four suites, **and a browser spec on the local stack**:
  `e2e/local/coverage/priority.spec.ts` — two jobs released through the wizard with a priority
  each and the SAME due date, their task lists approved, both booked onto one person on one
  day; the campaign row, the chip and the My Work row are then read for the mark, for the word
  *Normal*, and for the order. Every state made through the product, none through the back
  door. `SingleJobInput` gained `priority` so the helper can set it.
- [x] `I54.16` **An unassigned job escalates to traffic on its own** (the Figma's line; Edward, 22
  Sep: *"the escalation issue has been specifically discussed"* — ADR-0045). Migration
  `20260922170000`: `tenant_reminder_settings.assignment_escalation_hours` (default 24, d.3),
  `deliverables.assignment_escalated_at`, notification type `assignment_overdue`,
  `app.working_hours_between` (Fri/Sat not counted), `app.escalate_unassigned_jobs()` (service
  role) — an opened single job with an unassigned task past the hours goes to every `scheduler`
  (Traffic) AND the owner, once. **`supabase/functions/stall-sweep`** is ADR-0045 d.1's function,
  built with this rung; the review-reminder rungs (`I14.7`) join it. Words in notify-email EN/AR
  and the inbox. The Who-and-when line names the lead and the tenant's hours. pgTAP 146. RUNBOOK
  §5: deploy + hourly cron. **Not yet in Admin → Reminders (the screen does not exist — `I14.7`).**
- [x] `I54.17` **The review walk — one single job per kind of brief** (Edward, 22 Sep: *"do an
  automation to create a single job using a template of each type so I can review each screenshot…
  as a document with steps and screenshots"*). `e2e/local/walks/single-job-templates.walk.spec.ts`,
  `WALK=1`: every active template the tenant has (the `cov_…` residue skipped), SJ-v3-01 → the
  brief (every field filled) → Who and when → Review, as the account manager; S1, S2 and S4 walked
  once on the first template; nothing opened. Writes `Claude outputs/reports/<date>-templates/`
  (REPORT.md + REPORT.html + the shots; gitignored). Re-run after every change to the flow.

- [x] `I54.18` **A refused REORDER now says who can — done 23 Sep** (migration
  `20260923100000`, pgTAP 065 tests 19-20, local only). It said *"reordering this list is outside
  your scope"*; it now says *"You cannot reorder this list: it is outside your reach. The campaign's
  account manager, the department lead, or Traffic can."* Two faults, both exposed rather than
  caused by `I53.28`: a different word for the same check every other refusal uses, and nobody named
  to go to. Edward, 23 Sep: *"Error messages must be explicit, they should state who to contact."*
  **The other eight refusals of this family are `I54.20`.** Original entry:
- [ ] ~~`I54.18`~~ **The deliverables browser spec expects a sentence the product no longer says.**
  Found 23 Sep running `coverage/` on the local stack; **pre-existing, proved against the branch
  without this session's changes.** `deliverables-page.spec.ts:395` asserts the refusal banner
  reads *"outside your reach"*. It reads *"reordering this list is outside your scope"* — the
  database's own words, from `20260828230000`. Nothing is broken in the product: this is `I53.28`
  (22 Sep) working, where the dialog stopped INVENTING a sentence for any 42501 and started showing
  what the server said. The test was not brought to the new rule. Decide which wording is the one
  we want — the two refusals now read differently — then fix the string or the test, not both.

- [x] `I54.20` **Every refusal names the PERSON who can — done 23 Sep** (migrations
  `20260923110000` + `20260923120000`, pgTAP 148, local only). Edward chose naming real people over
  naming roles. **Nine refusals** now raise three things: an English sentence (for a log, or any
  surface not yet wired), `detail` = the names, `hint` = the action. The client composes from the
  hint, so an **Arabic reader gets an Arabic refusal with the same names** — which a sentence built
  in Postgres can never do, and which is why the names do not simply ride inside the message. That
  is also why `20260923120000` exists: `I54.18` an hour earlier built the whole sentence in the
  database, and one refusal in the set would have worked in English only.
  **Who is named, read off each function's own gate — no new rule invented:** the deliverable's
  owner (remove / cancel / reinstate / reorder, following `I49.66`), whoever may approve work for
  that person (ad-hoc), the department's approvers on that campaign (approve / re-open a brief), the
  campaign's account manager (promote / attach). **Nobody to name still says where to go** — a
  refusal that leaves a person with nowhere to turn is the fault this set exists to fix.
  New: `app.refusal_ask` + four name lookups (plain STABLE sql, no elevation), `namedRefusal()`
  shared by the deliverables, campaign and booking surfaces, 11 strings in both languages, 8 unit
  tests, pgTAP 148 (11). **`coverage/deliverables-page` is green for the first time** — it walks
  add, edit, reorder, cancel and remove in one go, which is why fixing one refusal changed nothing.
  Original entry:
- [ ] ~~`I54.20`~~ **Eight more refusals say "outside your scope" and name nobody.** Edward's rule, 23
  Sep: *"Error messages must be explicit, they should state who to contact if they need a task
  reordered."* `I54.18` fixed the reorder one; these are the rest, live in the database and shown
  verbatim by the surface since `I53.28`: `remove_sub_task`, `sub_task_cancel`, `sub_task_reinstate`,
  `create_adhoc_deliverable`, `approve_department_brief`, `reopen_department_brief`,
  `promote_single_job`, `attach_job_to_campaign`. Each needs the word **reach** and its own sentence
  naming who CAN — derived from that function's own gate, so no further decisions are needed.
  **The pattern to copy already exists and is better than naming roles:** the task-EDIT refusal
  names the deliverable's owner by their actual name (`I49.66`). Until this is done
  `coverage/deliverables-page` stays red — it walks add, edit, reorder, cancel and remove in one go.

- [x] `I54.19` **`coverage/schedule-page` "reassign by drag" — fixed 23 Sep.** It failed on about
  half of the full `coverage/` runs and never when the file ran alone. The first diagnosis here was
  half right and the real cause was worse: `bookingsOf` read EVERY booking row for the task,
  **cancelled ones included**, and callers took `[0]`. A reassignment does not edit a booking — it
  writes a new row and cancels the old — so from the first reassignment on there were TWO rows,
  both starting the same day, and `[0]` of a list ordered by start time was a coin toss. Now
  `bookingsOf` asks for the three live states the grid itself draws, and `liveBooking()` polls for
  the one row rather than grabbing it. Three full-folder runs since: green each time. Spec only —
  the product was never involved.

- [ ] `I54.21` **The account manager's "Waiting for you" panel is EMPTY in the browser while the
  database says it has a row.** Found 23 Sep on the local stack; **not caused by this session's
  work — it fails identically with every change stashed**, and it passed earlier the same day, so
  something in the shared local database drifted over a day of repeated runs.
  **The evidence, as far as it goes:** `Harbour Line Rebrand` is still `pending_approval` and still
  carries `am` as its account manager; calling `public.my_pending_approvals()` in psql with that
  person's claims returns the row. The browser renders **no panel at all**, which is the empty-list
  branch (`items.length === 0` returns null), not the error branch — so the read succeeded and came
  back empty for the session the browser holds. The gap is therefore between the JWT the browser
  signs in with and the one psql imitates.
  **The first diagnosis below was WRONG and is kept so nobody repeats it.** The stale sign-in was
  real and worth fixing (`I54.22`), but it was not this. The cause is `I54.25`: the query behind the
  panel TIMES OUT once the tenant holds a few hundred campaigns, and the panel's empty state and
  its timed-out state look identical. Superseded text follows.
  **~~PINNED, 23 Sep — and it is NOT a product defect.~~** Edward authorised the reset. On the freshly
  seeded database it still failed, but with a different face: *"Couldn't load your permissions"*
  across the whole page. That named the real cause — **the saved sign-ins in `e2e/.auth/`**.
  `auth.setup.ts` reuses a stored session for an hour (a deliberate rule from 15 Sep, about token
  rotation). A reset recreates every seeded person with NEW ids, so the stored session belonged to
  somebody who no longer existed. Deleting `e2e/.auth/` and re-running: **22 passed**, and two full
  `coverage/` runs since are clean.
  That also explains the symptom BEFORE the reset, which looked nothing like it: a session whose
  refresh token had been rotated degrades to anonymous, `my_pending_approvals()` returns no rows for
  `auth.uid()` null, and the panel correctly renders nothing. **No error, no clue, and the database
  answering perfectly well to anyone who asks it directly** — which is exactly how an hour was
  spent on it. `I54.22` hardens the rule so the next person loses minutes instead.

- [x] `I54.22` **A saved sign-in is checked before it is reused — done 23 Sep.** `auth.setup.ts`
  reused a stored session for an hour on the clock alone. That was not enough twice: a refresh
  token rotated by another context (15 Sep) and a `db reset` recreating every seeded person with
  new ids (`I54.21`, 23 Sep). **Both fail the same silent way** — an invalid session does not
  raise, the browser simply reads as ANONYMOUS, every list comes back empty and every page renders
  its "nothing here" state, while the database answers perfectly to anyone who asks it directly.
  So the failure points at the panel, the query, the permissions — anywhere but the login.
  Now the stored token is put to GoTrue (`/auth/v1/user`) before it is trusted, and anything less
  than a clean yes signs in again; the cost is one request per person per run and the cost of being
  wrong is one unnecessary sign-in. **Proved by breaking it**: the account manager's saved token was
  corrupted the way a reset corrupts it, and the run repaired itself — 22 passed, where this
  morning the same state produced a false failure that read like a product fault.

- [x] `I54.23` **The update-bar pair stands down instead of failing — done 23 Sep.** Two tests need
  the running app to know which build it is, which it only does when the RUNNER starts the dev
  server. A server started by hand carries no build id, and the pair reported that as a FAILURE,
  which reads exactly like the update bar being broken. They now `test.skip` with the reason and
  how to run them (stop your own server, or CI, where `playwright.local.config.ts` sets
  `E2E_BUILD_ID`). Edward, 23 Sep, option 1.

- [x] `I54.24` **Four browser tests decided things by POSITION in a list — fixed 23 Sep.** Not one
  bug; one habit, found by running `coverage/` six times and keeping every report instead of
  re-rolling until it went green. Each read a list and trusted its order:
  — **`schedule-page`** counted cancelled bookings as live and took `[0]` (`I54.19`).
  — **`campaign-phases`** read two deliverables `order=created_at` and asserted `[0]` was the
    original. Rows written moments apart can share a stamp; when they tied it reported *"the
    original was changed"* and took **three more tests down with it** — they inherit `promotedId`
    from it, so they each died on `campaign_id=eq.undefined`. One flake, four red lines, none about
    the product. Now found by id.
  — **`review-and-my-work`** uploaded four files seconds apart, ordered them by `created_at` and
    called `[1]` the PDF and `[3]` the image. Now ordered by `version` — the column that actually
    counts up — and each one is found by its content type, which is what the assertions mean.
    **This is the one that could not be confirmed when Edward asked**; the cause was found by
    reading, not by reproducing.
  — **`admin-catalogues` (Audit)** asserted that filtering by the FIRST entity changes the count,
    which is false whenever every audited row is of one kind — exactly a freshly seeded database.
    It now picks an entity that can narrow, and where none can, asserts the filter applies instead.
  **Six full `coverage/` runs on 23 Sep: 4 failures → 0, with the two update-bar tests skipping
  for a stated reason.** Every fix is in the tests; the product was not involved in any of them.

- [x] `I54.25` **"Waiting for you" timed out on a tenant with a few hundred campaigns — FIXED
  23 Sep** (migration `20260923130000`, pgTAP 149, local only).
  **Measured through the real API, same data, before → after:** department lead 7,393 ms (killed by
  the timeout) → **396 ms**; account manager 8,863 → **213**; Traffic 7,396 → **210**; Power Admin
  8,559 → **209**. In the database, the branch that caused it: **9,263 ms → 0.7 ms**; the whole
  list **9,056 → 253**. Every other page re-measured and unchanged (90–150 ms).
  **The cause, from the query plan.** Postgres prices a function at 0.0025 units unless told, so an
  authorisation check that runs several queries was priced like an integer comparison. The plan
  applied `sub_task_can_decide_extension(id)` across **every task in the tenant**
  (`Rows Removed by Filter: 1444`) before reaching the thirteen extension events it was for. Six
  functions now carry a real `cost`; the planner applies them last, after the cheap joins have
  narrowed 1,444 rows to 13. **No logic, no permission and no result changes — only the order the
  work is done in.** It is Supabase's own RLS-performance guidance applied to the planner's side.
  **Two things cost a day and are worth remembering:** the panel hides itself when the list is
  empty, so a list that never arrived looked exactly like an empty one; and `SET LOCAL` outside a
  transaction is silently discarded, so every early measurement ran as superuser with RLS off and
  said 48 ms. Both belong in traps.md.
  Original entry:
- [ ] ~~`I54.25`~~ ⚠️ **"Waiting for you" TIMES OUT on a tenant with a few hundred campaigns — a real
  defect, found 23 Sep.** `public.my_pending_approvals()` takes **~3.8 s** in psql on a tenant
  holding **224 campaigns, 270 deliverables, 1,444 tasks** — small for a real agency — and through
  PostgREST as `authenticated` it exceeds the statement timeout outright:
  `57014 canceling statement due to statement timeout`. Reproduced by signing in as the Content lead
  and calling the RPC exactly as the browser does.
  **Why it took a day to see:** the panel hides itself when the list is empty, and a timed-out read
  looks exactly the same — no panel, no error, nothing on screen. Meanwhile the same question asked
  in psql answers in seconds and returns 22 rows, so every instinct says the panel is fine and the
  test is wrong. It was blamed on stale logins (`I54.21`, `I54.22`) before this was found.
  **Why it matters:** this is the panel that tells a lead what only they can move — briefs, task
  lists, extensions, pending campaigns. On production it will empty itself silently as the agency
  grows, and nobody will be told anything is missing.
  **Before any tuning, two things are worth deciding:** whether the panel should say *"could not
  load"* rather than showing nothing when the read fails (it cannot tell the two apart today), and
  which of the function's branches is actually slow — it unions five, and `department_brief_unwritten`
  walks every campaign in the tenant. Needs measuring, then an index or a rewrite.

- [ ] `I54.26` ⚠️ **ON HOLD with chat, I59.40 (Edward, 27 Sep).** **The chat rail takes 113 SECONDS for somebody with a lot of work — found 23 Sep,
  NOT fixed.** `public.my_conversations()` measured at **111,966 ms** for the seeded maker on 224
  campaigns / 270 deliverables / 1,444 tasks. Through the API it reads as a 7.4-second timeout,
  because that is where the cut-off falls — the real figure is fifteen times worse.
  **`I54.25`'s fix does not touch it**: pricing every conversation function at 10000 changed it by
  nothing (113,180 ms). The plan is not the problem; the shape is. `STATE.md` has said so since
  31 Aug — *"Rail entitlement is O(n) in the tenant's deliverables — fine at current volume, paginate later"*
  — and it is now 270, so "later" has arrived.
  **What it means today:** /chat does not load for the busiest people, and the rail is the door to
  every thread. Needs its own decision — narrow the entitlement query, page the rail, or keep a
  membership table. Measure first: the O(n) note names the suspect but nobody has read the plan.

- [ ] `I54.27` **`/deliverables` does not show what it says it shows** (Edward, 23 Sep: *"the current
  /deliverables page in production actually shows tasks.. not deliverables"*). Checked, and he is
  right in two different ways:
  — **The Ad-hoc tab genuinely IS a task list.** ADR-0035 gives every ad-hoc task its own deliverable
    named after the task, so each row is one task wearing a deliverable's name. Nothing is wrong with
    the data; the page is showing tasks and calling them deliverables.
  — **The Campaign tab lists deliverables, but reads as tasks.** One row per thing being made — a
    "Key visual" with 13 tasks under it — yet every column but the name is a TASK-level fact:
    *Assigned by*, *Assigned to*, *State*, *Due*. A row with 13 tasks shows one assignee, so it looks
    like a task and is not one.
  Two different fixes. The first is a naming and grouping question (should ad-hoc work be listed as
  tasks, under one "Ad-hoc" heading, rather than as deliverables?); the second is a column question
  (a deliverable's row should carry the deliverable's facts — its owner, its progress, how many of
  its tasks are assigned — not one task's). **Wait for the section C work screen before touching
  it**: `I56.3` redraws this surface, and fixing the columns twice is waste.
- [x] `I54.28` **Step 1's top card laid out as SJ-v3-01** (Edward, 26 Sep: *"the how it came in section is neatly
  aligned underneath the for whom section"*). It was two columns side by side; now one card, stacked: For whom
  (with its Inherits tag on the heading line) and Client · Brand at 340px, a rule, then How it came in with the (i)
  and the clock notice on its heading line, and Who asked · How it arrived · Proof (optional) in one row. The
  arrival fields that open under the proof run the full width below the row (`BriefReceiptPanel` takes `leading`
  fields for that row; the campaign wizard's use is unchanged) and now carry the input style. The two grey
  sub-lines the frame does not have are gone. Not in the frame and kept: *What they asked for* (required) under
  the row. Not yet matched: the frame's *When* field in the row (the app records the arrival by hand below it),
  the proof's filed-file chip, and the page intro wrapping at 66 characters where the frame runs one line.
- [x] `I54.29` **SJ-v3-01 fine-tuning, Edward 26 Sep:** the wizard's Cancel is the frame's quiet grey word, no
  outline (single job and campaign wizard, `.wizard-cancel`; every other Cancel unchanged); step 1's main button is
  the frame's arrow button ("Start the {brief}" with the solid ▶), greyed until a brief is picked ("Start the
  brief"); the sidebar's current page is a violet fill with violet type, no edge bar; the intro no longer wraps at
  66 characters; **Inter is carried in the build (ADR-0114)** and is the display face too — until now nothing loaded
  it and every screen drew Segoe UI.

### I55 — A lead or an account manager schedules anyone (ADR-0098, accepted 22 Sep)

> Edward, 22 Sep, from production: *"we are removing the permission… allow all department leads and
> team leads to assign anybody to tasks, cross department included"*; *"an account manager/account
> director is also allowed to schedule anyone. leave stays with lead, not told."* ADR-0087's
> request step is withdrawn for every seeded role; the machinery stays for a custom scope-grant
> role. Branch `assign-anyone-22-sep`, off `main`.

- [x] `I54.30` **Step 3's owner is a drop-down: the department lead and every team lead** (Edward, 27 Sep; option A —
  it starts on the department lead). ADR-0083 addendum d.17 (amends d.8; d.12 folds in: with no department lead it
  starts on "Choose a team lead…" and release waits). `WhoAndWhenStep.tsx`, `SingleJobWizard.tsx` (the pick survives
  Back and a resumed job). Checked in the browser on the
  local stack: Creative starts on its lead, a team lead picked becomes the deliverable's owner at release, a resumed
  job keeps the pick; B5/B6 brought to the drop-down and passing. Corrected the same day (Edward): each entry is
  *name · Department lead* / *name · Team lead*; the note keeps its escalation line and opens "Assign the deliverable's
  owner."; the list is ALL the chosen department's leads, deputy team leads included (option A, not the company's).
- [x] `I54.31` **An edited job title came back as the old one** (Edward, 27 Sep). Reproduced: title changed on step 3 and
  saved, then Campaigns and back into the job (or browser Back) showed the old title until a reload — the wizard
  filled its form once from a cached read of the job (`useSingleJob`, 30 s cache), so every field edited before
  leaving could come back stale. Fixed: the job is read fresh each time it is opened (`staleTime: 0, gcTime: 0`).
  Re-checked in the browser after the fix, by the list and by Back/Forward.

- [x] `I54.32` **The count-back strip names the month** (Edward, 27 Sep: "Tue 8" → "Tue 8 Oct"). `lead-time.ts` `dayStrip`
  adds `month: 'short'`; the day label may wrap (`.sj-day-name`), which Arabic's longer month names need. Checked on
  screen: English at desktop and phone width, Arabic at desktop.
- [x] `I54.33` **A single job can have more than one deliverable** (Edward, 27 Sep: *"we need to be able to add a
  deliverable as only one is generated"*). Answers: every deliverable goes to the job's ONE department and owner (A),
  and shares the job's ONE due date (A). Step 3 "+ Add a deliverable" adds a row (what is needed, how many, channel,
  format; a bin icon removes it); saved in the draft (`requestRecord` deliverables[1..], `readStoredMore`) and restored
  on resume; the release sends them all (`complete_campaign_draft` already took a list; attach-to-existing moves them
  all); the review card counts them and lists "Also in this job"; the count-back starts from the type that needs
  longest (unit-only — no local type carries a lead time). The job page's "Open the deliverable" shows only while
  there is one. Checked in the browser: three deliverables, one removed and re-added, resume keeps them, release
  creates three rows with one owner and one due date, each with its own task list.

- [ ] `I54.34` **PARKED (Edward, 27 Sep: "I will ask the designer to deal with it").** A single job's dos and don'ts:
  "Rules it carries" (and step 2's Dos and don'ts section) shows only the CLIENT's rules, locked; the job cannot add its
  own; and the 360 / Influencer / Brand guidelines templates' free-text "Do's & Don'ts" field (`dosDonts`) is never
  shown there. The campaign already has an add-a-rule dialog (`AddRuleDialog`, I56.6). Put to Edward: replace the
  template's free-text box on single jobs with one-rule-at-a-time (A, recommended) or keep both (B). Waiting on the design.

- [x] `I55.1` **Scheduling reach is its own predicate; a lead or an account manager reaches every
  calendar.** Migration `20260922190000`: `app.resource_in_scheduling_scope` (true for a
  `department`, `team` or `account` scope over any active resource, else the narrow test) and
  `app.user_in_scheduling_scope`; the three booking policies, ADR-0040's trigger,
  `update_task_assignment`, `decide_assignment_request` and `my_pending_approvals` re-emitted whole
  onto it; `sub_tasks_manage_insert / _update` admit a caller who may schedule the row's assignee
  (the ad-hoc case through `save_sub_task`); leave and office closures untouched; pending requests
  closed as `withdrawn` with the reason. pgTAP 147 new; 098 rewritten with a custom-role requester;
  010, 027, 074, 141 brought to the rule. UI: `resourceInSchedulingScope` in `write-scope.ts`, the
  hook, the route and the refusal (the team/department/account refusal copy removed — those scopes
  are never refused by reach now). Browser: retest I3 rewritten (direct booking, nobody else told;
  the AM books too); I4 gains the extension REFUSE path (it was covered only by coincidence);
  the request dialog and chip baselined with the ADR as the reason. Guides 06 and 11, the
  notification copy reference, ADR-0087's header. **On production** — merged to `main` (PR #36) and
  `20260922190000` pushed, 22 Sep.

### I50 — A free room or piece of equipment is booked by whoever needs it; a taken one is a request (ADR-0094, accepted 16 Sep)

Edward, 16 Sep, eleven decisions answered one at a time. Free → booked at once by anyone signed in;
taken → the requester picks choose-another-slot / share / urgent-escalate; the owner (or the holder,
for a share) answers; every denial carries a reason; a request holds nothing; the schedule splits into
**People** and **Rooms & equipment** tabs; a task's kit goes through the same door and never holds the
task. Build order is the numbering. Each item: pgTAP where it touches the database, a browser test
for every control (I49 rule), refusals worded.

- [ ] `I50.1` **Migration `20260917100000`** (ADR-0094 d.1, d.2, d.4, d.5, d.7, d.11): `resources.owner_id`;
  `bookings.requested_by`, `bookings.shared`; the exclusion constraint re-cut so two `shared` rows may
  overlap and nothing else may; `resource_requests` (kind `share` · `escalate`; status `pending` ·
  `approved` · `refused` · `withdrawn` · `superseded`; reason required on refusal) with RLS in the same
  file; `resource_request_approvers` (owner → `bookings:approve` in reach → tenant-wide); `book_resource`
  (definer — free test by capacity model, writes `confirmed` as the owner); `decide_resource_request`
  (accept / approve-and-bump / move / deny); `withdraw_resource_request`; retire-closes and
  supersede triggers; the pass-on sweep (unanswered by the eve of the slot, office calendar); notification
  types `resource_requested`, `resource_request_answered`, `resource_booking_bumped`,
  `resource_booking_shared`. pgTAP: the cases named in ADR-0094 d.11, plus the anti-drift assertion
  (notified set = deciding set). `gen types` after push.
- [ ] `I50.2` **`subtask-schedule` books a task's kit through `book_resource`** (d.3, amends ADR-0042 d.4/d.6):
  free → booked for the task's days; taken → the function returns the clash lines instead of booking over,
  and the client puts d.2's three choices per line before the save completes. The task is never held.
- [ ] `I50.3` **`/schedule` splits into People (default) and Rooms & equipment** (d.8): the *Kind* filter
  becomes the tab; a Rooms & equipment cell offers **Book** to everyone (the `+` and its `bookings:create`
  test stay on People only); pending requests drawn as `requested` chips that count in nothing.
- [ ] `I50.4` **The conflict form** (d.2): on a taken slot the form names the holder (or the pending
  requester) and offers exactly three ways forward; *choose another slot* stays on the form; *share*
  and *urgent — escalate* (reason required) write a request. Wording before submit only mirrors the server.
- [ ] `I50.5` **`ResourceRequestActions` in the inbox** (d.5, d.6): a share → Accept / Deny-with-reason
  for the holder; an escalation → Approve-and-bump (confirm first, holder told) / Move (pick a free slot,
  approve in one) / Deny-with-reason for the owner. Never a refusal with no way forward: a slot that
  changed underneath offers Move or Deny.
- [ ] `I50.6` **The task's resource lines show `booked · requested · denied`, and the person's chip on
  People carries a pill with the same state** (d.3) linking to the Rooms & equipment tab. The requester's
  own "where it stands" line on their request (waiting — passed to …; denied — reason).
- [ ] `I50.7` **Admin → Resources: owner picker replaces the "Requires approval" tick box** (d.4, d.10);
  `deriveInitialState`'s `requiresApproval` arm removed with its unit cases. **Browser tests:** the member
  who books a free room and is offered three choices on a taken one; the holder who accepts a share and
  the colleague who cannot; the owner who bumps and the non-owner who cannot; **the `I49.69` pair** — the
  booker edits and cancels their own reservation, the non-booker sees Save and Cancel refused in words.
- [ ] `I50.8` **Drop `resources.requires_approval`** one release after `I50.7` is on production and nothing
  reads it (d.10).

**Three further ADRs commissioned 11 Sep, drafted in parallel by agents, all ACCEPTED the same day
after Edward answered fourteen numbered decisions — see `I45`, `I46`, `I47`.**
- **A NEW step after approval:** once released to the **Deliverable Owner**, that person **reviews,
  edits and approves the auto-generated task list** before it goes for assignment. Sits on something
  real — `app.materialise_deliverable_workflow` fires from a trigger today, so tasks appear
  automatically; this inserts a gate that does not currently exist.

### I45 — Booking within scope, and cross-department booking on approval (ADR-0087 — built, in review)
> Edward, 11 Sep: *"All users can book within scope, i.e. team leads .. all team members. department
> leads all department members... all users can book cross dept resources subject to the dept
> leads, or team leads approval."* **ADR-0087 accepted, 11 Sep.** *"Within scope"* is what
> `in_write_scope` already does — unchanged. Cross-department becomes a request row, no booking, no
> capacity held, drawn on the grid as *requested*; either lead answers, first wins; team members
> cannot request. **Edward corrected the draft**: naming a deliverable OWNER is not a booking and
> the AM does it directly; only placing somebody on `/schedule` is subject to confirmation. Fixture
> fault found and fixed: seeded resources had no department/team, so every one was unplaced.
> **Built 11 Sep** (`20260911110000`, test 098). Review: the request path now meets both
> assignment gates at request time (`20260911130500`), and the client mirror's team branch matches
> `in_write_scope` (0087 addendum). Still open below.

- [ ] `I45.1` **Approval whose `subtask-schedule` call throws** leaves an approved request and an
  assigned-but-unscheduled task with no retry surface in the request dialog or the inbox
  (`BookingDialog` has one). Same shape as `I40`'s unscheduled retry.
- [ ] `I45.2` **`BookingDialog` dead state after the merge:** the Provisional/Confirmed radio and
  `willNeedApproval` still render on a person row, where the only submit path books confirmed;
  staged requirements are silently dropped on `requested`; a new task's placement is decided from
  the mirror in the lean-ALLOW case. Pre-existing per the ADR's own context note.
- [ ] `I45.3` **The approval token is replayable** within a transaction that leaves
  `app.assignment_request` set — no exposed function does today. Make it one-shot on next touch.
- [ ] `I45.4` **Test 098 gaps:** no deny test for a direct insert/update on
  `sub_task_assignment_requests`; `tg_close_assignment_requests_on_resource` untested; a
  team-scoped lead over a team-less resource; the `done` close; a race on two requesters surfaces
  the raw `23505` rather than `request_pending`.
- ⚠️ **For Edward before `db push`:** the live tenant's unplaced human resources (locally 3 of 7 —
  the agency-wide roles) refuse requests by design (d.13). Measure live first.

### I46 — A formal deadline extension, subject to account-manager approval (ADR-0088 — built, in review)
> Edward, 11 Sep: *"We need a formal means to extend deadlines on tasks.... this is subject to AM
> approval."* Must land in `sla_events` (ADR-0075 — a breach must not delete itself when a date
> moves; an APPROVED extension is the one case the committed date legitimately changes).
> **ADR-0088 accepted, 11 Sep.** Request = date + mandatory reason + attribution; the campaign's
> AM answers, computed from scope; work never pauses; approval moves the committed date only.
> **Edward's addition (d.7a): the deliverable's date moves only on the CLIENT's agreement, recorded
> by the AM, with evidence attached or the change is refused.** The ad-hoc branch (request goes to
> whoever assigned) is a bridge until ad-hoc scheduling is retired. **Built 11 Sep** — `I46.1`,
> `I46.2`, `I46.4` closed; the review's additions are in the 0088 addendum (`sla_hours` fenced,
> commitment survives unassign, the deadline record is system-written, supersession tie, row locks).
> Review items still open: `I46.5`–`I46.8` below.

**Found while drafting ADR-0088 (11 Sep), each verified against the local database:**

- [x] `I46.1` **ADR-0075 was accepted on 9 Sep and its migration had never been written** (built 11 Sep, `20260911120000`). No
  `committed_*` columns exist on `sub_tasks`; `sla_events` has NO `sub_task_id` (its subject is
  deliverable / job / booking only), so d.3's *"writes a `deadline_changed` row"* cannot be done as
  written; and `deadline_set` / `deadline_changed` have never been emitted by anything — zero rows.
  `I41.4`'s note that d.3 *"now stamps `committed_starts_at`"* overstates it. **ADR-0088 depends on
  this existing and cannot be built before it.** Needs its own build item.
- [x] `I46.2` **An assignee could move their own deadline silently** (closed 11 Sep, `20260911121000`; `sla_hours` too). `sub_tasks_manage_update`
  carries `or (assignee_id = auth.uid())` with no column fence, and `save_sub_task` is
  `security invoker` with no gate of its own — so an assignee can set `due_at` on their own task via
  RPC or bare PostgREST, moving no booking and notifying nobody. Exactly the "breach deletes itself"
  case ADR-0075 exists to prevent, reachable by the person with the strongest motive. ADR-0088 d.11
  closes it; worth closing on its own if 0088 waits.
- [ ] `I46.3` **`deliverables_tenant_write` is unscoped** — `project_tasks:manage` alone, no
  `in_write_scope` — so the client-facing promise (`deliverables.due_at`) is guarded LESS than the
  task plan under it. Same shape as the ADR-0073 finding, one table over.
- [x] `I46.4` **Stale comment** (fixed 11 Sep): `EditBookingDialog.tsx:266` said Team Member holds
  `project_tasks:manage`; `20260825110000` removed it (Edward, 25 Aug). Trivial, but it is the kind
  of comment the next reader believes.
- [ ] `I46.5` **Ad-hoc job deliverables with a client sit outside the d.7a fence** — no campaign,
  so `deliverable_due_at_change` says "edit it directly" and the promised date moves with no
  evidence. Goes when ad-hoc scheduling is retired (ADR-0082 d.9); until then a known hole.
- [ ] `I46.6` **`sub_task_can_decide_extension`'s ad-hoc branch omits `caller_is_project_pm`**,
  though d.3 says d.2's reschedule authority answers and d.2 includes the PM.
- [ ] `I46.7` **Copy:** `arithmetic_at_risk` renders "Leaves -2 working days" for a request past
  the due day; `offerFromMove` shows a bare `YYYY-MM-DD` with no zone (ADR-0076 d.2); non-42501
  server messages are shown verbatim in English in three dialogs. `standingIn` on the dashboard
  tells a lead answering an ad-hoc request "your reach covers every account".
- [ ] `I46.8` **Evidence is any asset under the campaign**, including a deliverable's own final
  file or a dropped asset, not specifically a fresh upload into References as d.7a describes; and
  `DeliverableDueAtDialog` uploads before the RPC, so a refusal leaves an orphan.
- **A contradiction in the record:** `I41.2` (7 Sep) says *"no `deadline_changed` event was needed
  after all — `audit_row_change` covers it"*; ADR-0075 (accepted 9 Sep) says the opposite. The ADR
  wins (authority order). `I41.2`'s note is wrong and is corrected by this line.

### I47 — One mandatory reviewer, in one step; optional reviewers respond before approval (ADR-0089 — built, in review)
> Edward, 11 Sep: *"one mandatory reviewer must be appointed.. currently this is not enforced… the
> checkbox does not appear for mandatory. The task needs to be reopened to tick mandatory.. this two
> step process is ridiculous… review notifications are not being sent out… this has to become a
> single step."* And: *"optional reviewers still need to either provide feedback or indicate no
> comment prior to the mandatory reviewer approving. This way all feedback is collected in a single
> run."* Carries a DEFECT report whose stated cause is to be verified, not accepted — the ad-hoc
> booking path appoints a single reviewer with no mandatory option (`BookingDialog.tsx` ~98), and
> `tg_subtask_notify_reviewer` notifies every reviewer regardless of mandatory, so the mechanism
> Edward names is probably not the one at fault. Amends ADR-0043 d.5.
> **ADR-0089 accepted, 11 Sep.** Cause confirmed: the ad-hoc dialog's single select has no required
> option and `create_adhoc_deliverable` writes `is_mandatory = false`; the reopen is the two-step.
> Notifications ARE sent on submit — what actually happens is that with nobody required the first
> approval completes the task and every other reviewer's inbox row vanishes, and a reviewer
> appointed after submit is never told. Now: one required reviewer enforced at commit, a lone
> reviewer required by definition, optional reviewers ANSWER and no longer approve, and **the
> required reviewer's approval is a HARD WAIT on every optional answer (Edward, over the draft's
> warn-and-proceed)** — the escape hatch is removal by name.

> **Built 11 Sep** (`20260911100000`, test 097). Review: the Postgres-held completion guard now
> carries the d.6 wait too, and `responded_at`/`response` have their deny test (0089 addendum).

**Found while building ADR-0089 (11 Sep), each pre-existing:**

- [ ] `I47.1` **A task's review round never advances on a task-level send-back.** `app.task_review_round`
  reads `deliverables.revision_round`, which bumps only on the CONTAINER's `in_review/approved →
  in_progress` (`20260908150000:155`) — and under ADR-0077 a task's request-changes never moves the
  container. So `app.sub_task_submit` (`20260903110200`) accepts LAST round's note or version as
  this round's. The 0089 build anchored "this round" on the task's latest `submitted_at` instead;
  the round counter itself is still wrong and wants its own fix.
- [ ] `I47.2` **`app.tg_media_supersede_prior` supersedes per deliverable, not per task.** With
  several tasks under one container, a later upload on task B supersedes task A's head version.
  Invisible while ad-hoc work was one task per container; visible the moment a campaign
  deliverable's tasks upload independently.
- [x] `I47.3` **`NotificationType` in `notifications-api.ts:20` had drifted** (closed 11 Sep — the union is now complete and `notification-copy.test.ts` reads it as a fourth home) — was missing
  `rescheduled`, `chat_added`, `task_reinstated`, `brief_awaiting_approval`. The file's own comment
  warns of exactly this. `notification-copy.test.ts` checks the email map and the locales against
  the constraint but not this union; extend it.
- [ ] `I47.4` **`app.sub_task_submit` pins `search_path = public, app`** — no `extensions`, unlike
  every sibling. Harmless until it calls something in `extensions`; fix on next touch.
- ⚠️ **For Edward before `db push`:** 0089's data fix marks the EARLIEST-appointed reviewer as
  required on multi-reviewer tasks with none marked (per the ADR's letter). On a `done` task where a
  later-appointed optional reviewer was the one who actually approved, that reviewer is stamped
  `no_comment` and the earlier one becomes the required reviewer of record. Correct by the rule,
  possibly surprising in the history. The local tenant had 0 such rows; measure live with
  a one-off production diagnostic query (not included) §3/§6 first.

### I39 — Bulk assignment and bulk cancel ⚠️ *(ADR required before implementation)*
> Raised by Edward on 5 Sep, deliberately left open when I38 shipped: *"leave open"*. I38 is what
> makes it necessary — a 30-post calendar now lands 30 creation tasks, so distributing a month of
> social is thirty assignment decisions where it used to be one. The work is honest and newly
> visible; doing it one row at a time is not.

**Not a loop over the existing button.** Three things already in the system decide the shape, and
all three point the same way — a server-side loop with a per-row result, never all-or-nothing:

- **Assigning is four things, not one** — the person, the reviewers, the hours, the dates — and then
  a booking. `subtask-schedule` takes ONE `subTaskId` per call and reports a refusal as
  **HTTP 200 with a reason** (`scheduled: 0`), which is exactly how one ad-hoc task came to exist
  five times on 2 Sep (ADR-0061). A bulk caller that checks only whether the call threw repeats that
  at thirty times the scale.
- **Authority is per task** — `update_task_assignment` demands `project_tasks:manage` **and**
  `in_write_scope` for that task's department. A batch can legitimately be half-allowed, so a
  refusal must be reported per row rather than failing the set.
- **A live assigned task must have a reviewer** (ADR-0043), so the dialog collects reviewers, not
  just an assignee.

**Two decisions the ADR must record**, both put to Edward on 5 Sep and both recommended:
**partial success with a per-row report** (all-or-nothing would fail on almost every real batch),
and **one assignee per batch** (30 posts usually go to one designer; splitting across people in one
dialog is a scheduling screen wearing a dialog's clothes).

**Bulk cancel is the sharper one**, because a mixed selection is the norm and the two outcomes
differ: `remove_sub_task` DELETES a plan and CANCELS anything started. The confirmation must
aggregate both counts and the bookings released — *"12 are plans and will be deleted; 18 will be
cancelled, releasing 24 bookings"* — which is ADR-0068's single-task rule applied to a set.
Reinstating never recreates bookings, and that promise has to survive being made thirty times.

- [ ] `I39.1` ⚠️ **The ADR.** Blocked on nothing but the writing; it needs the two decisions above,
  the failure-reporting shape, and whether a batch spreads across working days or stacks on one.
- [ ] `I39.2` 🔒 Bulk assign — server-side, per-row results, spread across working days.
- [ ] `I39.3` Bulk cancel — the aggregated confirmation, plans and started work counted separately.
- [ ] `I39.4` Multi-select on the surfaces that need it. **There is none anywhere today**, so this
  is new interaction, not a new button.

---

### L6 — Flexible RBAC overlay (ADR-0036, accepted) — retires the TEMP alpha toggles
> Roles stay the foundation/default (shared bundles = a role, any department). A thin **per-user
> overlay** adds individual exceptions on **both** axes, changing only the two authorization
> primitives so every RLS policy + Edge Function inherits it. Grant administration is **Power
> Admin-only for now** (acceptance condition); delegated per-department administration deferred.
> **Sequence:** ship the overlay green (L6.1–L6.4) → seed the real accountable people's grants →
> **then** revert TMP.1/1a/2/3 (L6.5).
- [x] `L6.1` 🔒 Schema: `user_grants` (tenant/user/resource/action/**effect allow|deny**/granted_by/reason; FK → `permission_catalog`) + `user_scope_grants` (tenant/user/department?/team?/granted_by/reason; both-null rejected); RLS enabled+forced; new catalog entries `user_grants:view` / `user_grants:manage`; **no-self-grant** (`user_id <> auth.uid()`) + `client_portal`-fenced write policies; ADR-0033 `search_path` pin on all new/changed functions — **DONE** (migration `20260823100000`; reviewed). Refinements from review: `granted_by` server-stamped + `NOT NULL`; add/remove only (no UPDATE policy, like `role_grants`); `chk_user_grants_no_deny_admin` fences `deny` on `user_grants:manage`/`roles:manage` (no self-lockout). **Needs `db push` + `gen types` (Edward).**
- [x] `L6.2` ⚙️ Extend the two primitives (additive migration): `app.has_permission` → `(role OR user-allow) AND NOT user-deny` (**deny wins**); `app.in_write_scope` → role-scope **OR** `dept ∈ user scope-grants` **OR** `team ∈ user scope-grants` (a granted department covers its teams, ADR-0014 parity). No per-policy rewrites. — **DONE** (migration `20260823100100`; reviewed: prior role/scope bodies byte-identical, `search_path` re-pinned inline). **Needs `db push` (Edward).**
- [x] `L6.3` 🔒 pgTAP (disproportionate): role-only baseline unaffected · allow adds exactly one action · **deny removes a role action (precedence)** · scope-target permits exactly the named team/dept and no other · self-grant denied (`42501`) · cross-tenant grant denied · `client_portal` cannot receive grants · revoked-grant latency — **DONE** (`supabase/tests/039_user_grants_overlay.sql`, 35 assertions; reviewed). **Runs in CI database job / `scripts/db/verify.sh` — not yet executed here.**
- [x] `L6.4` Frontend — **DONE (reviewed).** (a) `permissions.tsx` unions role + user grants and applies deny so `can()` mirrors `app.has_permission`. (b) Per-user editor: `UsersPage` "Permissions" action (gated `user_grants:manage`; hidden for self + `client_portal`) → `UserPermissionsDialog` — effective-grants matrix (From role / Override / Effective), `Deny` disabled for the un-deniable admin grants (`user_grants:manage`/`roles:manage`), additive scope-target picker; `user-grants-api` add/remove hooks (`granted_by` server-stamped); EN/AR; tests. Typecheck + lint + 255 unit tests green. **Deferred to L6.5:** expose the caller's own `user_scope_grants` in the permissions context so the restored scoped `canBook` mirror is scope-aware (inert today — `canBook` is wide-open under TEMP alpha).
- [x] `L6.5` ⚙️ **Revert TMP.1/1a/2/3 — DONE (reviewed: ship).** Migration `20260823110000`: de-blanketed `seed_tenant_roles` + surgical DELETE of the illegitimate blanket grants per role; restored scoped booking-write policies (`20260812120100`/`20260819140000`, incl. PM bypass); restored `create_adhoc_deliverable` combined scope gate + `reviews:moderate` reviewer check (no-self-review kept); dropped `can_moderate_deliverable` and restored the four review-moderation gates to `reviews:moderate`; restored `update_task_assignment` scope gate. Frontend: scope-aware `canBook` (`DayGrid`) reads the caller's own `user_scope_grants` (exposed in `permissions.tsx`); `useReviewers` reverted to role-based moderators. pgTAP: flipped the four `TEMP alpha` assertions in `002/007/010/027` to `throws_ok('42501')`; `037` reduced to the permanent no-self-review guard. Typecheck + 255 tests + lint green. **⚠️ Edward on apply: (1) grant the accountable people via the editor BEFORE applying this migration; (2) the surgical DELETE can't tell an alpha blanket row from a grant you hand-added on the Roles screen during alpha — re-apply any such intentional role grants after.**
- [x] `L6.7` **Overlay-aware ad-hoc reviewer naming — DONE (Option B).** Migration `20260823120000`: new `app.user_holds_permission(user, resource, action)` (role ∪ user-allow − user-deny — the arbitrary-user analog of `app.has_permission`); `create_adhoc_deliverable`'s reviewer check now (1) verifies the reviewer is in-tenant then (2) uses `user_holds_permission` for `reviews:moderate` — so a `reviews:moderate` granted via the editor overlay makes someone a *nameable* ad-hoc reviewer. `useReviewers` made overlay-aware to match. pgTAP `040` (baseline reject · overlay-allow accept · deny-wins). Typecheck + 255 tests green.
- [x] `L6.8` **Edge Functions bypass the overlay — DONE (code); needs `db push` + deploy (Edward).**
  Migration `20260824100000` adds `public.has_permission(text,text)` (invoker, STABLE, `search_path`
  pinned, execute revoked from `PUBLIC`/`anon`); `supabase/functions/_shared/authz.ts` is the single
  `hasPermission()` helper (fail-closed: any RPC error is a DENIAL, so deploying ahead of the
  migration refuses everyone rather than admitting them); all 8 call sites now ask it on the
  **caller-scoped** client — `chat`, `update-user`, `invite-user`, `list-user-status`, `asset-url`
  and `review-media` were checking on the **service-role** client, which has no `auth.uid()` and
  could never have seen the overlay. pgTAP `041` (shape: invoker · STABLE · pinned · anon cannot
  execute; agreement: role grant · per-user ALLOW · **DENY beats role** · no-identity → false).
  `scripts/check-authz-call-path.mjs` + `npm run check:authz`, wired into CI, fails on any
  `.from('role_grants'|'user_grants'|'user_scope_grants')` under `supabase/functions/` — self-tested
  by re-introducing a read and confirming exit 1. `AGENTS.md` §2 carries the rule. Post-deploy: a live 500 on
  cancel/approve/reject — `booking-transition` still used the `held` grant set 120 lines below where
  it had been deleted, and an uncaught throw attaches no CORS headers, so the browser reported it as
  a CORS failure. `held` is now rebuilt from the primitive, and the two gaps behind it are closed:
  CI runs `deno check` over `supabase/functions/` (nothing type-checked them before the deploy did),
  and `_shared/http.ts` `guarded()` wraps all 11 handlers so an unexpected throw returns a proper
  CORS-bearing envelope with the detail in the function log, not the browser. Original finding: `20260823100100` asserted "every RLS policy **and Edge Function** funnels through
  `app.has_permission`"; verified false — all 8 grant-checking functions query `role_grants` directly
  off the JWT `app_role_id` (`subtask-schedule:61`, `booking-transition:131`,
  `deliverable-transition:66`, `asset-url:79`, `review-media:78`, `invite-user:94`, `update-user:58`,
  `chat:56`). So a per-user **allow** is invisible (403 where RLS would permit — observed live) and a
  per-user **deny** is invisible (**fails open** — the serious half). `app.has_permission` sits in
  schema `app`, which PostgREST does not expose, so the functions cannot call it today. Work:
  (a) migration adding `public.has_permission(text,text)` — STABLE, **invoker**, `search_path` pinned,
  execute revoked from `PUBLIC`/`anon`, granted to `authenticated`+`service_role`; (b) swap all 8 call
  sites to `rpc('has_permission', …)`; (c) pgTAP (role allow · overlay allow · **deny beats role** ·
  anon denied); (d) CI grep asserting no file under `supabase/functions/` references
  `role_grants`/`user_grants` — pgTAP cannot execute an Edge Function, so this check, not the suite,
  is what holds the rule; (e) correct the false comment in `20260823100100`; (f) `AGENTS.md` §2 rule.
- [x] `L6.9` **Data remediation from the L6.5 revert + the alpha reviewer picker — THE QUESTION;
  answered by the `L6.9` entry below (24 Aug: nothing lost).** Kept for the record only — one ID, two
  entries, which is why it read as outstanding. (no code — Edward,
  at the console). (a) The `L6.5` surgical DELETE could not distinguish an alpha blanket grant from
  one hand-added on the Roles screen; at least one real user lost her role's whole `bookings` set this
  way and a per-user overlay grant does **not** compensate until `L6.8` lands (see above) — re-apply
  the intended **role** grants. (b) While `TMP.2` was live the reviewer picker listed every internal
  user, so deliverables created then may name a reviewer who does not hold `reviews:moderate`; those
  are **stuck** (they can neither approve nor send back, with no on-screen explanation). Query in the
  morning runbook; fix is reassignment, not code.
- [x] `L6.9` **Data remediation after the L6.5 sweep — CHECKED, nothing lost (24 Aug).** Task
  reviewers: `scripts/db/list-task-reviewers.sql` over 30 open tasks — 0 standalone orphans, 0
  reviewers lacking `reviews:moderate` (the TMP.2 open-picker risk did not materialise), 3
  deliverables created with "Any reviewer" and therefore none. Role grants: the booking/schedule
  matrix matches the authoritative seed exactly — `scheduler` and `department_lead` hold the full
  set, everything else is false in the seed too. **Not bugs but role-design questions surfaced:**
  `account_manager` cannot create/update bookings despite "assigns/coordinates within their
  accounts"; `team_member` has no `schedule:view` at all; `team_lead`/`deputy_team_lead` can create
  and update bookings but not cancel them.
- [x] `L6.10` ⚙️ **Identity from the database, not the token (ADR-0037 d.6) — code done, needs
  `db push` (Edward).** Migration `20260824110000`: new `app.current_identity()` (role/department/team
  for `auth.uid()`, read live from `user_profiles`), with `current_role_id` / `current_department_id`
  / `current_team_id` rewritten over it — same signatures, same null-when-unknown behaviour, so no
  policy or function changes. A role, department or team change now takes effect on the **next
  request** instead of the next token refresh (default 1h), which is the "I changed it and nothing
  happened" class of confusion. `SECURITY DEFINER` **solely** to bypass RLS on that one row:
  `user_profiles_admin_all` calls `app.has_permission`, so an invoker read would recurse forever. The
  JWT claim remains as a fallback when a caller has no profile row, so a provisioning gap degrades to
  today's behaviour rather than a lockout; `update-user` keeps writing the claims, they are simply no
  longer authoritative. pgTAP `043` (11): definer + pinned + anon-denied; a **role change visible on
  the same unchanged token**; JWT fallback; and selecting `user_profiles` does not recurse.
- [x] `L6.11` ⚙️ 🔒 **Grant tables privatised (ADR-0037 d.0/4/5) — code done, needs `db push` +
  frontend deploy TOGETHER (Edward).** Migration `20260824120000`, one transaction, three parts.
  (A) `app.has_permission`, `app.in_write_scope` and `app.user_holds_permission` become **SECURITY
  DEFINER**, bodies otherwise byte-identical — **not optional**: an invoker check reading a table the
  caller may not read returns zero rows, so every permission would evaluate false including an
  admin's (deciding `admin.roles:view` would require reading `role_grants`), and a grant-dependent
  SELECT policy on `user_grants` would re-enter `has_permission` forever. (B) SELECT on `role_grants`
  narrows to `admin.roles:view`, on `user_grants`/`user_scope_grants` to `user_grants:view` — closing
  the least-privilege hole where any authenticated user could enumerate every colleague's permissions,
  and delivering the strong form of the ADR-0037 rule: an ordinary caller **cannot** read these
  tables, so it cannot re-implement the check. (C) self-scoped RPCs replace the three ordinary-user
  reads — `public.my_permissions()` (computes `(role ∪ allow) − deny` in the DB, removing the last
  copy of that formula from the frontend), `public.my_scope_grants()`, and
  `public.users_holding_permission()` **allowlisted** to `reviews:moderate` +
  `account_manager:manage` (an open parameter would let anyone ask who holds `users:manage`) which
  also now excludes deactivated people — a filter the reviewer picker never had. Frontend:
  `permissions.tsx`, `useReviewers`, the account-manager picker. The Dev "view as role" preview
  (ADR-0019) still reads `role_grants` directly — it asks about a *different* role, which is not
  self-scoped, and it is Power-Admin-only. pgTAP `044` (16). **Caveat:** a holder of
  `user_grants:manage` without `admin.roles:view` sees an empty "From role" column in the per-user
  editor; Power Admin holds both, so this bites only if the grants are ever split.
- [x] `L6.12` ⚙️ 🔒 **A role's reach is chosen, not defaulted (ADR-0041, accepted) — code done, needs
  `db push` + `gen types` (Edward).** Migration `20260825100000`. `roles.scope` had carried
  `not null default 'tenant'` since `20260812100100`, and the Roles screen never asked for it —
  "scope" appeared zero times in `RolesPage.tsx` and in neither `CreateRoleArgs` nor
  `UpdateRoleArgs`. So a role created through the UI silently took the **widest** reach in the
  system. Already happened: the tenant holds `cco` (`is_system` false, scope `tenant`) which appears
  in no seeder. ADR-0008 d.2 says admins create roles from the UI; ADR-0009 d.3 gave roles a reach
  but named it only for the seeded ones — the column default answered the question neither ADR asked.
  **DB:** default `'tenant'` → `'self'`; `app.protect_system_roles` reproduced verbatim from
  `20260802100000` with `scope` added to the system-role immutable list and the ADR-0033
  `search_path` pin applied (the original predates that rule), so Power Admin cannot be narrowed and
  Client Portal cannot be widened — the screen disables the field, Postgres is the boundary
  (AGENTS.md §2). **No row is touched** (d.7): silently re-scoping a live role in a migration is the
  same class of unannounced authority change this ADR prevents, so `cco` keeps `tenant` until Edward
  changes it. **Frontend:** `lib/role-scope.ts` (ordered values, `self` default, `isWidening`);
  reach on the create dialog defaulting to `self` — **copying a role copies its grants, never its
  reach**; reach on the detail form (disabled for system roles); reach badge on every list row;
  changing reach on a live role holds the save behind a confirmation naming the **active holder
  count** (`useRoleHolderCounts`, `user_profiles` is tenant-readable so it is exact) and calls out a
  widening separately. 17 EN+AR keys incl. a plain-words explanation per reach (parity checked).
  pgTAP `049` (11) — first assertion is the defect itself: a role created naming no reach comes out
  `self`. Unit: `role-scope.test.ts` (7, incl. the picker's five values matching
  `roles_scope_check`, and every reach having words in both languages), `NewRoleDialog.test.tsx`
  (4, new file), `RolesPage.test.tsx` +5. Typecheck + lint + 285 tests green.
  **⚠️ Edward after apply: review `cco` — it holds company-wide reach nobody chose.**
- [ ] `L6.6` (deferred, own ADR) Delegated administration: let a Department Lead grant within their own department — bounded design + escalation-vector tests before it ships

### ⚠️ Temporary alpha toggles (REVERT before GA)
> **Retirement path accepted → ADR-0036 (L6).** These flip back to scoped deny-by-default via `L6.5`
> once the flexible overlay ships and the real accountable people carry their grants as data.
- [x] `TMP.1` **Schedule is wide-open for editing — REVERTED (L6.5 / ADR-0036, migration
  `20260823110000`; re-verified 26 Aug).** Revert path complete: (a) the blanket-grant block is gone
  from `seed_tenant_roles` and (b) the already-applied grants were deleted from the live rows
  (§A.1/§A.2), (c) the scoped booking-write policies are restored (§A.3), (d) no `TEMP alpha`
  assertion remains in pgTAP, and (e) the grid's scope mirror is back and then some — `DayGrid`
  now asks `canWriteResource(action, resource)`, which mirrors `app.resource_in_write_scope`
  per action rather than the single `bookings:create` check it was relaxed to (`I12.13`).
  Original entry — migration `20260820040000` (Edward, alpha). Every
  role except `client_portal` was blanket-granted `schedule:view` + `bookings:create/update/delete`, AND
  the three booking-write RLS policies were relaxed to **grant-only** (dropped `resource_in_write_scope`
  + the PM-ownership bypass). So **any internal user can view and edit ANY booking in the tenant** —
  Team Members included. Leave/blackout editing is unchanged. **Revert path:** new migration that (a)
  removes the blanket-grant block from `seed_tenant_roles` and re-seeds, (b) restores the scoped
  booking-write policies from `20260812120100` (delete) and `20260819140000` (insert/update), then (c)
  flips the four `TEMP alpha` assertions in pgTAP `002/007/010/027` back to `throws_ok('42501')`, and
  (d) restores the scope-mirrored `canBook` in `src/features/schedule/components/DayGrid.tsx` (it was
  relaxed to `can('bookings:create')` alone so the grid stops blocking out-of-team resources with the
  `schedule.notAuthorisedBook` notice). Full pgTAP suite verified green on PG16 with the relaxation.
- [x] `TMP.1a` **Ad-hoc task assignment is wide-open too — REVERTED (L6.5, `20260823110000` §B.4:
  the combined `project_tasks:manage` + `in_write_scope` guard is back in `create_adhoc_deliverable`).**
  Original entry — migration `20260820050000` (extends TMP.1).
  TMP.1 only relaxed the *booking-write* path (RLS policies); an **ad-hoc task** assigned on a person
  instead goes through the `SECURITY DEFINER` RPC `public.create_adhoc_deliverable` (ADR-0035), whose
  own `project_tasks:manage` **AND** `app.in_write_scope(assignee dept/team)` gate bypasses RLS — so a
  Team Member (scope `self`) still got `42501 → schedule.outOfScope` ("outside your write scope…") when
  assigning to anyone outside their team. This migration relaxes the RPC to match: **keep** the
  `project_tasks:manage` grant gate, **drop** `in_write_scope`, and add an **explicit same-tenant
  assignee check** so tenant isolation is preserved. Verified on PG16: out-of-team same-tenant assign
  now succeeds; cross-tenant assignee rejected (`22023`); no-permission caller rejected (`42501`);
  invalid reviewer rejected (`22023`). No pgTAP asserted the old RPC scope, so none flipped.
  **Revert path (with TMP.1):** new migration restoring the combined guard
  `if not (app.has_permission('project_tasks','manage') and app.in_write_scope(v_dept, v_team, null))`
  from `20260820010000` (drop the grant-only gate + the explicit same-tenant check — `in_write_scope`
  implies same-tenant).
- [x] `TMP.2` **Anyone can be assigned as an ad-hoc reviewer — REVERTED (L6.5, `20260823110000`
  §B.4–§B.9: `app.can_moderate_deliverable` dropped and all four gates restored to `reviews:moderate`;
  `useReviewers` reads `users_holding_permission('reviews','moderate')` again; the no-self-review guard
  was kept, as specified).** Original entry — migration `20260820060000`
  (Edward, alpha). ADR-0035 added `deliverables.reviewer_id`, but every gate a reviewer must pass to
  close the loop was keyed on the **global** `reviews:moderate` grant — the `deliverables_reviewer_update`
  RLS policy (the `deliverable-transition` Edge Function runs as the caller, so RLS bites), the transition
  guard's `approved`/send-back branches, and `app.sub_task_request_changes` — so a non-moderator named
  reviewer was stopped before Approve / Request changes. This toggle adds
  `app.can_moderate_deliverable(id)` = *holds `reviews:moderate` **OR** is that deliverable's named
  `reviewer_id`* and swaps it in at those three gates plus the `review_feedback_resolve_update` policy,
  and **drops** the "reviewer must hold `reviews:moderate`" check in `create_adhoc_deliverable` (any
  same-tenant user may now be named). The RPC also **rejects `reviewer = assignee`** (no self-review — a
  permanent guard, kept on revert); the reviewer picker already excludes the assignee. Frontend
  `useReviewers` lists **all** same-tenant users (except
  `client_portal`) instead of only moderators. Deliverables with `reviewer_id = NULL` (every campaign
  deliverable) are unchanged — `can_moderate_deliverable` collapses to `has_permission('reviews','moderate')`.
  New pgTAP `037` proves the override (designated non-moderator can approve/request-changes; a
  non-designated non-moderator still can't; the moderator path is unchanged). Verified on PG16: migration
  applies on all predecessors + the 7-way behavioural check passes. **Not the intended permanent model.**
  **Revert path:** new forward migration that (a) `drop function app.can_moderate_deliverable(uuid)`,
  (b) restores `deliverables_reviewer_update` to the `reviews:moderate` USING/WITH CHECK from
  `20260817110100`, (c) restores the `approved`/send-back authority branches in
  `app.tg_deliverable_transition_guard` to the bare `has_review` / `has_review or has_manage` form from
  `20260819150000`, (d) restores the `if not app.has_permission('reviews','moderate')` gate in
  `app.sub_task_request_changes` from `20260820030000`, (e) restores `review_feedback_resolve_update` to
  the author-or-moderate form from `20260818110000`, (f) restores the "chosen reviewer must hold
  `reviews:moderate`" check in `public.create_adhoc_deliverable` (keeping the TMP.1a grant-only scope
  until TMP.1a reverts, **and keeping the no-self-review `p_reviewer <> p_assignee` guard — that one is
  permanent**), (g) reverts `useReviewers` to the `reviews:moderate`-only picker, and (h) removes pgTAP
  `037` (keeping its self-review assertion elsewhere if desired).
- [x] `TMP.3` **The schedule task-edit RPC is grant-only — REVERTED (L6.5, `20260823110000` §C.10:
  the `in_write_scope` check is back in `update_task_assignment`).** Original entry — migration `20260820070000` (`I11.7`). Editing a
  task from the booking modal via `public.update_task_assignment` is gated **grant-only**
  `project_tasks:manage` (the per-assignee `in_write_scope` check is dropped), matching TMP.1/TMP.1a so any
  manager can edit any task in the alpha. **Revert (with TMP.1):** new migration adding
  `and app.in_write_scope(v.department_id, v.team_id, app.deliverable_account_manager(v.deliverable_id))`
  back to the RPC's gate. The `sub_tasks.updated_by` column/trigger, the info display, and the
  no-self-review guard are **permanent** — keep them.

### Security hardening (ADR-0033)
- [x] `SEC.1` Supabase Security-advisor pass (migration `20260819250000`): pinned `search_path = public, app, extensions` on every `app`/`public` function (lint 0011) + **standing rule** that every future `create/replace function` carries the `SET` clause (esp. reproduced seeders — a reproduction without it silently re-raises the warning); closed the `create_internal_project` `anon` EXECUTE leak by revoking from `PUBLIC` (0028 — it had been revoked from `anon` only, still inherited via PUBLIC membership). **Accepted as-is:** the three DEFINER RPCs callable by `authenticated` (0029 — self-authorizing). **Deferred:** `btree_gist` in `public` (0014 — backs the bookings exclusion constraint, cosmetic). **Dashboard (Edward, per project):** enable Authentication → Password security → **Leaked password protection**.

- [ ] `SEC.2` **Periodic security review (recurring — run before each release + roughly quarterly).** A standing pass over every layer, not just the DB. Re-run each time and record the date + result:
  - **RLS / policies:** rerun the `pg_policies` audit — every `public` policy scoped by `current_tenant_id` + a grant/scope check; no unexpected `USING (true)` (only `permission_catalog` is allowed); every table RLS **enabled + forced**. Confirm all 45 tables via the `pg_class` check.
  - **Supabase advisors:** Advisors → Security **and** Performance, rerun the linter on **both** `maestro-dev` and `maestro-prod`; expect 0 critical; the only accepted WARN residue is ADR-0033's set (3× `0029` DEFINER RPCs + `btree_gist` `0014`). Investigate anything new.
  - **Edge Functions + service role:** review each function's authorization (caller checks before privileged writes), that the **service-role key never reaches the client**, and CORS/allowlist. Functions: `invite-user`, `update-user`, `list-user-status`, `booking-transition`, `deliverable-transition`, `review-media`, `asset-url`, `chat`, `notify-email`.
  - **Secrets / keys:** service-role key (dashboard only), Resend key, Backblaze B2 keys, `CRON_SECRET`, Vault entries — confirm none are committed to git or exposed to the browser; rotate on any suspicion.
  - **Auth config:** leaked-password protection ON (prod), OTP length/expiry, redirect allowlist, session/JWT settings; MFA posture reviewed.
  - **Dependencies:** `npm audit` (frontend) + Deno import review (functions); triage highs/criticals.
  - **Frontend:** confirm guards/nav are defense-in-depth only (RLS is the real boundary), no secrets in the bundle, no `USING`-bypassing direct queries.
  - Log each run's outcome here or in an ADR; net a short "reviewed YYYY-MM-DD, clean/▲findings" line. See ADR-0033 for the accepted-residue baseline.

**Sequenced after Phase I:** M8 (joint projects), M10 (client portal + client feedback/approval), P2 (accountability/SLA engine + attribution/rewards + anti-gaming; wires KPI/attendance/started-ahead numbers to consequences), V1.9 (deck editing), V1.10 (huddles).

---

## Phase 1 — MVP (§12: ~2–4 weeks indicative)

Scope per §12: resource model + capacity, scheduling timeline, bookings, approval routing, role-scoped
views, Tier-1 dashboard, auth/roles, tenant isolation **with** joint-project sharing, accountability-ready
schema (Odoo analytic code field, dual cost/charge rates, ad-hoc job shape), scoped client portal
(monitor / feedback / approve), and the campaign calendar as a read-only projection.

### M1 — Schema core & tenancy (nothing retrofitted later) ✅ schema complete
- [x] `M1.1` 🔒 Tenancy spine: `tenants`; `tenant_id` on every table (pgTAP-enforced structurally); RLS enabled+**forced** in each creating migration; `app.current_tenant_id()` from JWT app_metadata only
- [x] `M1.2` Org entities: `clients` (+ Kite sibling relations, portal flag), `brands`, `departments`
- [x] `M1.3` Resources: kind (human/equipment/room), capacity model `exclusive`/`pooled(n)`/`load_based(ceiling, warn_at)` with CHECK-enforced parameter shape; humans forced load-based (§4.1)
- [x] `M1.4` Work structure: `work_types` (lead time, SLA/accountability profile refs) → `campaigns` → `streams` (campaign_id NOT NULL — one campaign per stream) → `deliverables`; `sla_profiles` + `accountability_profiles` config stubs
- [x] `M1.5` Ad-hoc `jobs`: client-anchored, optional campaign + source-deliverable links, both-null normal
- [x] `M1.6` Bookings: five states; generated `tstzrange`; exclusion constraint `confirmed ∧ exclusive → no overlap` (race-proof, trigger-maintained exclusivity flag); tenant-tagged allocations
- [x] `M1.7` Blackouts: `resource_unavailability` as its own concept
- [x] `M1.8` Append-only event logs: `sla_events` (attribution enum, actor = caller enforced) + `audit_events`; INSERT-only policies **and** UPDATE/DELETE revoked
- [x] `M1.9` Finance-ready: `odoo_analytic_code` on tenants/clients/campaigns/jobs; dual `cost_rate`/`charge_rate` on resources
- [x] `M1.10` `media_records` (provider-swappable, tier, retention, Frame.io link-out) + `review_feedback` (round, source, timecode, x/y, resolved)
- [x] `M1.11` pgTAP suite green (30 tests): structural RLS check on ALL tables, adversarial two-tenant isolation (reads, writes, spoofing, anonymous, count-leaks), booking invariants, role-scoped writes, append-only. `scripts/db/verify.sh` runs it locally + in CI (new `database` job)
- [x] `M1.12` Migrations applied to `maestro-dev` (`supabase db push`); real types generated (`gen types --project-id`); typecheck green against live schema. (VPN interference caused the CLI hang/403 detour — noted in README.)

### M2 — Auth & roles ✅ (deploy steps pending — M2.5)
- [x] `M2.1` Supabase Auth: email+password login (Zod-validated, testids, EN/AR); session context (`src/app/auth-context.tsx`); provisioning via `invite-user` Edge Function (admin-only, sets app_metadata claims + profile atomically, optional resource link, audit event) + `scripts/bootstrap-admin.mjs` for the first admin
- [x] `M2.2` Role model wired end-to-end: claims (`app_metadata.tenant_id`/`app_role`) are server-set only; `ROLE_HOME`/`ROLE_NAV` single-source module (configurable-later seam, OD 9)
- [x] `M2.3` Guards: `RequireAuth` + `RequireRole` (redirect to own home — absence, not hiding); per-role landing routes; nav built from role map (leakage asserted in unit tests)
- [x] `M2.4` i18n EN/AR live: dir+lang switch together, AR covers every EN key (tested), logical-properties-only CSS tokens, RTL login verified by screenshot; system font stack pending a font-pairing ADR (OFL fonts need an allowlist decision) — **Inter: ADR-0114, 26 Sep** (OFL allowed for fonts; Inter self-hosted); IBM Plex Sans Arabic still unloaded
- [x] `M2.5` Deployed + bootstrapped: Meridian tenant and first admin live; sign-in verified — admin lands on `/admin` with role-scoped nav. (Bootstrap sets a temp password directly — recovery-link flow deferred until the reset screen exists; secrets live in `.env.local`, gitignored)

### M3 — Capacity engine ✅ (pure engine in `src/lib/capacity/`; authoritative execution lands in the M4 Edge Function; UI surfaces in M5)
- [x] `M3.1` Load accumulation: boundary-sweep segments, peak within window, per-resource ceiling/warn-at; confirmed-only consumes capacity (§4.2)
- [x] `M3.2` Exclusive conflict detection (mirrors the DB exclusion constraint for UX pre-check) + pooled(n) concurrent counting (back-to-back never double-counts)
- [x] `M3.3` `assessCandidate()` warn-and-allow: single composed verdict (`ok`/`warn`/`over_ceiling`/`conflict`) with reasons + message params; only exclusive conflict maps to a DB refusal — everything else informs
- [x] `M3.4` Blackout overlap → warn with spans reported, never a block (§4.3)
- [x] `M3.5` + working week (ADR-0005): `offices.working_days` migration (+pgTAP, 35 db tests green incl. the NULL-check cardinality trap); office-local day math via Intl in the OFFICE's zone; 22 engine unit tests incl. Baghdad-Friday vs Dubai-Friday divergence, Cairo DST fall-back day, office-midnight end-exclusive edge
- [x] `M3.6` Migration pushed to maestro-dev; types regenerated and synced (UTF-8)

### M4 — Booking lifecycle & approval routing ✅ (deploy pending — M4.5)
- [x] `M4.1` `booking-transition` Edge Function: create (single/series), approve, reject, cancel, expire_holds (cron-secret path). Runs as the CALLER (RLS enforces end-to-end); runs the shared capacity engine authoritatively; optimistic-concurrency guard on transitions; audit + sla events; DB 23P01 mapped to a clean 409. Pure state machine in `src/lib/bookings/state-machine.ts` (table-driven tests over the full from→to matrix)
- [x] `M4.2` Approval routing: `resources.requires_approval`; booker's confirm request → tentative (approver confirms/rejects); team_lead/admin confirm directly; warnings never downgrade — only the exclusive conflict refuses (and falls back to tentative)
- [x] `M4.3` Recurrence: `booking_series` (weekly, interval 1–8, count 2–52) + `bookings.series_id`; wall-time-preserving expansion — Cairo series holds 10:00 local across the DST fall-back (tested)
- [x] `M4.4` Race test (`scripts/db/race-test.sh`): two concurrent sessions confirm overlapping exclusive slots — one winner, loser blocks then gets 23P01; 41 pgTAP + 46 unit tests green
- [x] `M4.5` Series/approval migration pushed; types regenerated; `booking-transition` deployed; CRON_SECRET set and stored in password manager (hold-expiry scheduling wired in V1.4)

### M5 — Scheduling day-cell grid (ADR-0006; supersedes the first timeline build)
- [x] `M5.1` Day-cell grid: rows = resources, columns = dates (week / 2 weeks / 4 weeks + prev/today/next); per-office non-working-day cell shading (ADR-0005) + blackout cell hatching; today highlighted
- [x] `M5.2` Cell add action → the ADR-0006 popup: project (campaign) · task (free text) · provisional/confirmed · hours/day · optional end date. Hours are the input, load % derived server-side (8h standard day). Multi-day = daily series (one instance per day, per-day capacity exact). Global + button retained; per-cell + is the primary path
- [x] `M5.3` Warn-and-allow: client preview (advisory) across all instance days — first submit shows the single warning, second proceeds; Edge Function re-derives + re-assesses authoritatively; needsApproval/conflict surfaced
- [x] `M5.4` Chip drag between cells (day↔day, row↔row) via native DnD through the extended reschedule action (resource move supported, re-assessed, DB-guarded); click-to-edit dialog (keyboard path): date/hours/resource + cancel booking
- [x] `M5.5` dnd-timeline removed from app deps (ADR-0004 superseded for this surface; spike retained as reference for future sub-day-precision needs); booking↔campaign link column added
- [ ] `M5.6` ~~Filters: department / resource kind / office~~ **DONE (verified 26 Aug — dept, team, kind
  and office filters on `/schedule`, URL-param driven, options derived from the resource pool),
  plus a name search and a sticky date row (31 Aug).** **The code half is finished; what keeps this
  open is MANUAL QA, not a build:** an RTL visual pass on the grid, and a full-pool performance
  check (see `L5.4`). Re-verified 6 Sep.
- [x] `M5.7` **DONE (verified 26 Aug — both migrations are far behind the current head and
  `booking-transition` has been live all through the pilot).** Original note: Edward: `supabase db push` (daily-freq + campaign-link migrations) · regen types (Out-File utf8) · `supabase functions deploy booking-transition` · re-run visual checklist
- **Feedback triage (2026-08-17, pilot enabler for `L5.5`):** Power Admin can now **resolve** a feedback item with an **action-taken note** (and **reopen** it) on the `/admin/feedback` screen. New deny-by-default ability **`admin.feedback:manage`** (auto-granted to Power Admin via the ADR-0008 catalog-insert trigger + whole-catalog seed) gates the table's first **UPDATE** RLS policy; a **BEFORE-UPDATE guard trigger** freezes the original submission (content + provenance immutable) and stamps the resolver identity/timestamp **server-side** (client can't attribute a resolution to someone else), mirroring the insert actor-pin. `status`/`resolution_note`/`resolved_by`/`resolved_at` columns + `feedback_status` enum. Reading unchanged (`admin.feedback:view`). No new ADR — extends the `app_feedback` table that shipped with the triage-fields comment already in place. (L5.5, [alpha-feedback])
- **Schedule refinements (2026-08-16, pilot feedback):** week starts **Sunday** (Sun–Fri working week, MENA) across Week/2-week/4-week + the team-load window (`currentWeek`); resource rows **grouped by department** with sticky section headers (alphabetical dept, then name); **non-working (weekend) columns collapse** to a minimal 46px and auto-expand to full width the moment a booking lands on them (collapses only when off for every office shown). Refines M5.1 within ADR-0005/0006 — no new ADR. **Note:** the **Baghdad office working week** may need Friday added (Admin → Organization → Offices) to show only Saturday as the weekend. (M5.1)

### M6 — Role-scoped views (Surface vs. Engine contract, §2.3)
> **ADR-0018 accepted (2026-08-15) — dashboard architecture ratified.** Dashboards are **grant-driven,
> scope-parameterized, three-tier surfaces** (Tier 1 action / Tier 2 exception feed / Tier 3 health),
> reconciled against all ADRs in `docs/dashboards-role-surfaces-plan.md`. Decisions: new **`exceptions:view`**
> (oversight feed — Dept Lead / Team Lead / Deputy / Account Manager, scope-parameterized) and **`health:view`**
> (CEO/COO/CFO) grants **shipped** in migration `20260815120000` (verified: correct holders, Team Member excluded,
> deputy≡team-lead parity kept). Individuals' own exceptions stay **Tier 1** (`my_tasks:view`). Leads land
> **pre-filtered to their domain** (opt-out to wider). Engine-gated rows (SLA breach/blocked/unassigned, health
> metrics) are **additive** as the ADR-0010 engine lands. **Buildable-now follow-ups:** surface
> `department_id`/`team_id`/`scope` in the client claims; department-scope variant of the Team surface; M7.4 news
> placeholder. Account Manager's project-scoped feed waits on the engine (D5).
- [x] `M6.1` Booker surface: timeline + availability only; no performance data — **`/schedule`, DONE
  (verified 26 Aug).**
- [x] `M6.2` Creative surface: their queue, their deadlines; no capacity math, no billing, no one else's
  SLAs — **`/my-work`, DONE (verified 26 Aug).** The "blocked on client" flag is **not** built and will
  not be: ADR-0030 removed Block entirely in favour of soft dependencies + "started ahead".
- [x] `M6.3` Team lead surface: team load at a glance, over-ceiling flags — **`/team`, DONE (verified
  26 Aug: live team-load KPI, per-person Overloaded/Near/Healthy badge, "Needs your attention" rail).**
  - ✅ **Interim shipped (2026-08-15, built to Pencil frame 16 "Team Health"):** `/team` (`src/features/team/`) renders the **Team Health** layout — **KPI cards** (On-time / At-risk / Avg turnaround marked *"Soon — to be implemented"*; **Team load %** live), a **member table with a capacity Status badge** (Overloaded ≥ ceiling / Near capacity ≥ warn / Healthy), and a **"Needs your attention"** rail listing over/near-capacity people (over first, "N over their capacity ceiling" summary). Capacity signals are live from `useScheduleResources` + `useBookingsList` (warn = `warn_at_pct`, over = `load_ceiling_pct`); SLA-driven KPIs/items are engine-gated (ADR-0010) and marked pending, **not faked**. **Scope-parameterized** (ADR-0018 D4): team/department-scoped viewers default to their domain with a whole-org toggle. `team:view`-gated, EN/AR, RTL-correct. Test `TeamPage.test.tsx`. **Still M6.3 v1:** the SLA-driven KPIs/exception items and per-item next-action buttons (frame 04) once the engine lands.
  - ✅ **Capacity exception now surfaced at ALL THREE tiers (2026-08-15, ADR-0018 §6.5 "same data, different altitudes"):** shared `capacityLevel()` + `CapacityBadge`. **Tier 1 — My Work:** `useMyLoad` renders the signed-in person's own "load this week" card with status (Overloaded/Near/Healthy). **Tier 2 — Team Health:** done (above). **Tier 3 — Company Health (frame 05):** `CompanyHealth` on the Overview, gated `health:view` (CEO/COO/CFO + Power Admin) — company load %, people-over-capacity summary, and a **per-department rollup** (load %, over count, status). All capacity-live; SLA KPIs pending. Drill-down company → department → team → person is now consistent. Tests: `capacityLevel` unit + `CompanyHealth` rollup.
- [x] `M6.4` **Done (verified 26 Aug, closed 6 Sep):** `/admin/users`, `/admin/resources` (capacity defaults),
  `/admin/roles`, `/admin/organization` and `/sla-profiles` all exist. **The one gap:** work types have
  no admin CRUD — they are seeded and read-only everywhere in the app. Original note: Admin surface: configuration area (work types, SLA profile stubs, capacity defaults, roles) — one-time setup posture (§2.2 "default, don't configure") **Closed 6 Sep:** the one stated gap was work types having no admin CRUD, and ADR-0056 retired work types altogether (pgTAP `069`). There is nothing left to build.
- [x] `M6.5` Role-scope leakage audit — **DONE (verified 26 Aug):** pgTAP `017_surface_scope_leakage`
  server-side, `src/app/nav-config.test.ts` per role client-side (power admin / traffic manager / team
  member / portal / no-grants). Original note:: walk each role's surface line from the design doc as a test script; no role sees another role's controls (§2.3 structural test)

### M7 — Tier-1 dashboard (individual action surface, §6.2)
- [x] `M7.1` Per-person aggregation: active work, deadline proximity, items waiting on this user —
  **DONE (verified 26 Aug):** `/my-work` (`lib/my-work.ts` — Today incl. overdue, Upcoming, awaiting-my-
  review rail) and the `/admin` overview. Blocked flags dropped with Block (ADR-0030).
- [x] `M7.2` Ranked "what to do next" list; healthy not-yet-urgent work stays quiet — **DONE (verified
  26 Aug):** the My Work triage ranks by urgency and keeps not-yet-urgent work out of Today.
- [x] `M7.3` **SUPERSEDED — ADR-0030 removed Block** in favour of soft dependencies + specific external
  inputs, with "started ahead" rewarding initiative. Not to be built. Original note: "Blocked on client" flag → logged as a visible, reversible claim (OD 5 leaning) feeding the attribution log **Closed 6 Sep:** superseded, not to be built.
- [x] `M7.4` **Company & industry news feed — DONE (verified 26 Aug: `src/features/news/NewsFeed.tsx`
  on My Work, the `/admin` overview and `/team`).** Original note: — every role's **default dashboard** (My Work / Team / Overview / Schedule landing) carries a news feed keeping all users current on internal **company** developments and **industry** news. **Interim (pilot): a placeholder widget** ("Company news — coming soon") so the slot is visible now — ✅ **placeholder shipped 2026-08-15** (`src/features/news/NewsFeed.tsx`, on My Work / Team / Overview; EN/AR). The real feed (authoring / content source, industry pull, per-tenant, moderation) is post-pilot. ⚠️(OD 31) open: content source — manual in-app posts vs external/RSS pull. See `docs/dashboards-role-surfaces-plan.md`.
- [~] `M7.5` **Header search — HIDDEN for the pilot (2026-08-15).** The unwired `E2EV1.pen` topbar search read as a dead control, so it's removed from the shell (`AppShell` topbar; controls right-aligned via `.topbar-right`). **Still to build (post-pilot):** the real **global jump-to / command palette** — type a resource, person, booking ref, or campaign and navigate straight to it, grant-scoped to what the caller may see. Restore the topbar element when it does something.

### Dev tooling (removable)
- [x] `DEV.1` 🧪 **"View as role" dev preview — DONE (2026-08-15), removable (ADR-0019).** A **Power-Admin-only** floating Dev panel to preview the app as **any role + team + department** without logging in/out — accelerates UI/UX iteration. Overrides **only client-side** permission checks (nav / route guards / scope-defaulting / landing) via a **preview-aware `usePermissions`**; **RLS and data are unaffected** (they key off the real JWT), so it's safe — a preview can never grant data access. **Writes are blocked while previewing** by a single client-fetch guard (`src/lib/preview-guard.ts`: refuses `/rest/v1/` + `/functions/v1/` writes, never reads/auth). A loud "Previewing as X" banner + Exit. Files: `src/app/dev-preview.tsx`, `src/app/DevPanel.tsx`, `src/lib/preview-guard.ts`; wiring in `permissions.tsx` (effective role/dept/team + exposed `departmentId`/`teamId`), `AppShell`, `main.tsx`, `lib/supabase.ts`. Tests: `preview-guard.test.ts`. **To remove:** delete those 3 files + revert the wiring (the preview-aware branch in `permissions.tsx`, the banner/`<DevPanel/>` in `AppShell`, the provider in `main.tsx`, the `guardedFetch` in `lib/supabase.ts`).

### Storage & data residency
- [ ] `INF.1` ⚠️(OD 30) **Local vs cloud storage — tenant files/media/data residency.** Huddle **recordings** are settled (ADR-0016 / OD 27: cloud-first R2 with TTL → permanent **tenant-local** backup; Iraq/Egypt lack usable cloud). Still open is the **general** case: where uploaded **media, exports, and (long-term) the database** live for Iraq/UAE/Egypt tenants — single cloud region (today: Supabase `eu-central-1`, L4.1) vs per-tenant **local/in-region** storage for residency-sensitive clients. Likely its own ADR. Blocks nothing for the pilot; decide before onboarding any client with a hard residency requirement.

### M8 — 🔒 Joint-project sharing (two-part RLS, §10.4)
- [ ] `M8.1` Joint project model: single nominal host tenant owns configuration (OD 12 resolved); invited tenant with project-scoped grant (home role does not carry over)
- [ ] `M8.2` Two-part RLS: "your tenant's rows + granted joint-project rows, per-field rules, evaluated symmetrically"
- [ ] `M8.3` Tenant-tagged allocations: each side books only its own resources; both see the combined schedule
- [ ] `M8.4` Shared progress/milestones visible both ways; internal rates/ceilings/other-projects never cross
- [ ] `M8.5` 🔒 Disproportionate test suite: every joint-project access path answers "which side is this, and is this field shared or internal?" — adversarial tests attempting cross-tenant reads in both directions

### M9 — Campaign calendar (read-only projection, §8.1 / OD 22)
- [ ] `M9.1` Calendar projection over each campaign's streams, deliverables, milestones and SLA-derived dates — **no new scheduling data stored**
- [ ] `M9.2` Work-type lead-time derivation (forward reading of §5.4) sufficient to compute commence-by / due dates for the projection
- [ ] `M9.3` Shared cross-team surface: read-only for delivery teams; **account manager is the only role that edits milestone/go-live dates** (v15 resolution)
- [ ] `M9.4` Reference link shape to a future planning-calendar entry (contextual link only, never a sync — §8.1)

### M10 — 🔒 Client portal (monitor / feedback / approve, §10.2)
- [ ] `M10.1` ⚠️(OD 21) Decide portal sub-step order (ships as one unit vs. monitor → feedback → approve sequenced) — record as ADR, then execute below in that order
- [ ] `M10.2` Portal auth: client-portal user type scoped to one client entity; separate, minimal external surface
- [ ] `M10.3` Monitor: client-facing status/milestone roll-up of the client's own work only — stripped of rates, capacity, SLA clock, other clients (exclusion list, §10.2)
- [ ] `M10.4` Feedback: pinned/timecoded comments on own deliverables via the Tier-2 review record — provenance = client-sourced at capture (attribution upgrade, §5.5)
- [ ] `M10.5` Approve: first-class audited approval event (who, which deliverable **version**, when) at **milestone/stream level** (OD 19 resolved v15) — **ADR-0023**: approval promotes the accepted delivered version into `Final Assets`; it persists nothing new (the version was already filed at delivery)
- [ ] `M10.6` Portal campaign calendar: milestone + go-live dates only, never deliverable-level dates or internal deadlines (OD 20 resolved v15)
- [ ] `M10.7` Signed, expiring, per-deliverable media URLs scoped to the client's own work (§10.2 storage implication)
- [ ] `M10.8` 🔒 Disproportionate test suite: every portal-reachable tile, thread, deliverable and media URL verified to expose only this client's own, client-visible fields — adversarial tests as another client and as anonymous
- [ ] `M10.9` "Blocked on client" ↔ portal action linkage: client feedback/approval events close the blocked interval automatically (attribution at source)

### M11 — MVP hardening & exit criteria
- [ ] `M11.1` End-to-end walkthrough per role using the §2.3 surface lines as scripts (first-time-user test)
- [ ] `M11.2` Timezone/DST test matrix across the three offices (§12 note)
- [ ] `M11.3` Load test: full expected resource pool + 25–30 users on the timeline
- [ ] `M11.4` Security review pass on all RLS policies (M1, M8, M10) before any external client user is invited
- [ ] `M11.5` Deploy to production; onboard first internal users; capture friction list

---

## Phase 2 — Full v1 (§12: ~6–10 weeks total, indicative)

### V1.1 — Time tracking & utilization (Worklenz reference, §9.2)
- [ ] `V1.1.1` Time entries against bookings/jobs; timesheet entry UI (per-role: minimal for creatives)
- [ ] `V1.1.2` Utilization as computed database views, not stored values (§9.2 pattern)
- [ ] `V1.1.3` Utilization surfaces for team lead + admin only (role scoping)

### V1.2 — Rates & finance data (no billing engine — OD 8 resolved, §9.5)
- [ ] `V1.2.1` Rate model live: internal cost rate + external charge rate per resource; rate precedence + rounding rules specified before coding (§12 note)
- [ ] `V1.2.2` Labour cost = hours × cost rate; charge lines = hours × charge rate, per person / job / project

### V1.3 — Odoo finance export (§9.5)
- [ ] `V1.3.1` Export views: total per client, total per job/project, line per person, weekly/monthly summaries — roll-ups, never raw time entries
- [ ] `V1.3.2` Export carries exactly the eight requested data points; omits the four Finance declined (billable split, materials, deadlines met, notes)
- [ ] `V1.3.3` 🔒 Period lock: month-end close freezes exported figures; locked period provably immutable (test: attempt mutation post-lock) (§13 finance-export integrity)
- [ ] `V1.3.4` Daily delivery: CSV/spreadsheet import file + human-readable report ⚠️(OD 24: push on schedule vs. pull on demand — leaning scheduled push with manual re-run)
- [ ] `V1.3.5` ⚠️(OD 23) Analytic-account code validation once Finance confirms the Odoo import template

### V1.4 — Notifications & reporting
> **`V1.4.1` (notification engine) pulled forward into Phase I (ADR-0024 → `I5`)** — in-app (native Supabase inbox, ADR-0026) + email (Resend, direct). Reporting (`V1.4.2`) stays here.
- [ ] `V1.4.1` Notification engine: booking/approval events, deadline proximity, blocked-state changes; in-app + email
- [ ] `V1.4.2` Baseline reports: bookings, utilization, delivery status per client/campaign

### V1.5 — Tier-2 dashboard: oversight exception feed (§6.3)
- [ ] `V1.5.1` Exception detection job: deadline proximity, approval age, capacity breach, block state, unassigned work
- [ ] `V1.5.2` Severity × time ranking (breached hard deadline for key client outranks soft internal one) — defaults documented
- [ ] `V1.5.3` Every exception names a person + a direct next action ("late, waiting on X's approval, [open]")
- [ ] `V1.5.4` ⚠️(OD 10) Manual at-risk flag that itself becomes an exception (leaning: yes, alongside automatic triggers)
- [ ] `V1.5.5` Exception-first guarantee: healthy work never renders on the lead's feed (§6.3 principle box)

### V1.6 — Contextual chat (§7.1 · **ADR-0015 accepted 2026-08-13**)
> **Pulled forward into Phase I (ADR-0024 → `I4`), single-tenant** — cross-tenant threads stay deferred to M8.
> Architecture + plumbing decomposition lives in ADR-0015 (`V1.6.1`–`V1.6.7`: schema+RLS from slack-clone baseline · Realtime Authorization on `realtime.messages` · `send-message` Edge Function + client outbox · reconnect/catch-up · chat UI fork of the Supabase Broadcast component · notifications via in-transaction trigger + **native Supabase inbox** (Novu dropped, ADR-0026) · isolation pgTAP). Product-requirement tasks below stand.
- [ ] `V1.6.1` Messages table in Postgres (durable record) with tenant/project/item association; Realtime = delivery only, transport = **Broadcast** (ADR-0015) (§13)
- [ ] `V1.6.2` Consolidated channels: per tenant / per active project, filtered client-side — never one subscription per thread
- [ ] `V1.6.3` Threads render in place on bookings, jobs, approvals, breaches
- [ ] `V1.6.4` 🔒 Cross-tenant threads on joint projects: shared by default, internal-only threads as the exception; mis-scope tests (§7.3)
- [ ] `V1.6.5` ⚠️(OD 14) Measure connection/cost under real load; confirm Broadcast fan-out holds. **SpacetimeDB rejected (ADR-0015: 2nd source of truth + BSL license); escape hatch = Centrifugo (permissive) or Ably before Durable Objects**, only past ~8k concurrent / genuine edge-latency need (§7.2)

### V1.7 — Brief system & job creation (§8.1)
- **Campaign Builder / Brief Wizard DONE (2026-08-16, ADR-0020 Phase B).** `/campaigns` (Client Services working surface, gated `projects:manage` — Account Manager / Scheduler / Power Admin) with a "+ New Brief" entry point → `/campaigns/new`. Five-step wizard (frames 21.1–21.5): Job Type (client·brand·brief type·name) → Strategy (nine fields authored once) → Deliverables (name·discipline·qty·load) → Timing (manual commence/due per deliverable + go-live) → Review (streams-per-discipline) → submit. Submit is one atomic RLS-governed RPC `create_campaign_from_brief` writing campaign → one stream per discipline → deliverables; strategy stored as `campaigns.brief jsonb` with audience/insight/proposition mirrored; richer deliverable spec (qty/load/commence) kept in the brief. Disciplines seeded as `work_types` from the design (Creative, Social & Content, Production, Influencer, Activation, Paid Media). Odoo codes stay Finance's remit — **not** a wizard input (Edward). `src/features/campaigns/`.
- [x] `V1.7.1` Concept brief: 360 campaign (spawns streams) or standalone single-discipline — **DONE** (brief type on Step 1; streams spawned per discipline on submit)
- [x] `V1.7.2` Campaign holds strategic core once; streams inherit automatically, add discipline fields only — **DONE** (strategy authored once in Step 2 → `campaigns.brief` + mirrored columns; per-discipline brief fields are the additive next cut)
- [ ] `V1.7.3` Execution brief (lightweight single-task) and Feedback brief (revision round + source: client/internal/both) — brief types present in the picker; the lightweight single-task + feedback-loop flows are follow-ups
- [ ] `V1.7.4` Concept → Execution → Feedback loop wired to revision-bounding fields
- [ ] `V1.7.5` Ad-hoc job UI: full accountability citizen (work type, owner, clock fields, finance line) with lighter ceremony (§8.1) — reuses the same pieces (ADR-0020 §6)
- **Follow-ups:** Step-4 automation (SLA-derived dates + auto-routing) lands with the SLA engine (M9/P2) without reshaping the wizard; per-discipline brief templates; optionally set Account Manager's `default_route` to `/campaigns`.
- [ ] `V1.7.6` Brand asset library: brand-level assets referenced (not copied) by campaigns/streams/deliverables; cross-tenant visibility rules
- [ ] `V1.7.7` Brief-driven scheduling: briefed work generates schedulable deliverables with derived due dates

### V1.8 — Tier-2 media review (§8.2)
> **`V1.8.1–8.3` pulled forward into Phase I (ADR-0024 → `I3`), internal source only** — client-sourced review arrives with M10; `V1.8.4/8.5` (OD 17/18) stay open.
- [ ] `V1.8.1` Media upload → deliverable version chain; web playback/viewing — **ADR-0023**: this chain (`media_records`) is the internal review store; delivered versions are referenced (not copied) into the Library
- [ ] `V1.8.2` Pinned x/y comments on images; timecoded comments on video (click-to-seek); resolved-state
- [ ] `V1.8.3` Review rounds + client/internal source attribution inline for the maker — **ADR-0023**: rounds + page/x-y feedback attach to internal `media_records` versions; the explicit "Deliver to client" action is the per-version, re-enterable delivery trigger
- [ ] `V1.8.4` ⚠️(OD 17) Upload format decision: web-ready MP4 vs. raw masters (decides whether a transcoding step is built)
- [ ] `V1.8.5` ⚠️(OD 18) Frame.io link-out field on media record (loose coupling default); no deep API integration yet
- [ ] `V1.8.6` Media on B2/R2 behind CDN with signed URLs — not Supabase Storage for heavy media (§8.3)

### V1.9 — Collaborative deck editing: Collabora Online (§8.4)
- [ ] `V1.9.1` ⚠️(OD 26/29) Deployment route: source build (forced if edit-event patch proceeds) vs. CODE image for dev only — ADR
- [ ] `V1.9.2` WOPI host endpoints on privileged routes (CheckFileInfo / GetFile / PutFile) with Supabase JWT tokens
- [ ] `V1.9.3` Decks stored on B2 keyed on campaign/stream/deliverable hierarchy; AD authors in PowerPoint, uploads v1, platform takes custody
- [ ] `V1.9.4` Version-on-save → version rows ⚠️(OD 25: collapse versions per session; forced version at approval + client delivery) — **ADR-0023** fixes the *forced version at client delivery* (atomic deliver RPC snapshots the version); per-save session-collapse still open
- [ ] `V1.9.5` Per-user, per-deliverable rights via CheckFileInfo (contributor writes, client reviewer reads)
- [ ] `V1.9.6` Brand-font installation into the Collabora container; fidelity re-test procedure on every upgrade (§13 live-dependency risk)
- [ ] `V1.9.7` PowerPoint escape hatch explicit in UI: download → edit natively → re-upload

### V1.10 — Huddles: LiveKit (Cloud-first, self-host fallback) (§7.4 · **ADR-0016 accepted 2026-08-13**)
- [ ] `V1.10.0` 🔬 **OD 28 GATE — voice MUST traverse corporate firewalls (hard requirement, Edward 2026-08-13):** prove audio join/publish from real Iraq/UAE/Egypt corporate/restricted networks; escalate **embedded TURN (TLS 443) → standalone coturn → in-region self-host** until it connects. **No huddle feature ships until this passes.**
- [ ] `V1.10.1` ADR-0002 sign-off for **LiveKit Cloud** (paid dependency) — or self-host decision if the OD 28 spike forces it (LiveKit software is Apache-2.0)
- [ ] `V1.10.2` **Recording residency + ownership DECIDED (ADR-0016 / OD 27):** cloud-first **R2 with TTL** → permanent copy to **tenant-local backup** (Iraq/Egypt lack usable cloud); **host/primary tenant owns** the recording even with external invitees. Build: egress→R2 + retention/archival job. **Consent mechanism + per-jurisdiction legal review still required before recording is enabled.**
- [ ] `V1.10.3` Contextual huddle attached to deliverable/stream/campaign/ad-hoc job; starts from and returns to the thread; recording lands as a thread artifact in sequence
- [ ] `V1.10.4` Ad-hoc huddles: not scheduled, not booked, never consume capacity. Scheduled huddles: tracked but **non-blocking** (no confirmed state, no capacity consumption) (§7.4)
- [ ] `V1.10.5` Recording default-on, audio-first; screen-share recording only when explicitly enabled; creator opt-out logged + auditable
- [ ] `V1.10.6` Join-time consent notice + persistent visible indicator for all participants
- [ ] `V1.10.7` 🔒 Per-huddle playback rights enforced by RLS; joint-project recordings respect §10.4 boundaries; retention follows §8.3 lifecycle
- [ ] `V1.10.8` Scheduled-huddle time vs. delivery time metric (the diagnostic the consolidation buys)

### V1.11 — v1 hardening (§12 note: the expensive 20%)
- [ ] `V1.11.1` Edge-case specification pass *before* coding fixes: booking spanning a holiday, partial cancellation, re-approval flows
- [ ] `V1.11.2` SLA clock rules: business vs. calendar hours, per-office holidays/weekends (Iraq/UAE/Egypt differ — incl. Fri/Sat vs Sat/Sun weekends)
- [ ] `V1.11.3` Billing rounding + rate precedence test matrix
- [ ] `V1.11.4` Full regression + accessibility + RTL pass

---

## Phase 3 — "Phase 2" Accountability Surfaces (post-v1 validation)

### P2.1 — SLA engine surfaces (§5.4)
- [ ] `P2.1.1` ⚠️(OD 1) Confirm full accountability-type list per role — the single highest-leverage open item; resolve first
- [ ] `P2.1.2` SLA profiles configurable per work type: measured points, committed vs. estimated completion, revision allowance, breach handling, billing linkage
- [ ] `P2.1.3` Deadline derivation live: auto from work type (standardized) / explicit at intake treated as hard (bespoke)
- [ ] `P2.1.4` ⚠️(OD 4) Deadline authority + scope-change events (change after start ≠ silent edit)
- [ ] `P2.1.5` Pausable, attributable clock: every elapsed interval attributed to assignee / client / dependency / approver ⚠️(OD 5)
- [ ] `P2.1.6` Revision bounding: allowance before deadline renegotiates
- [ ] `P2.1.7` Stage-gated SLAs for Production pipeline (pre-prod → on-set → post-prod milestones, §5.1)

### P2.2 — Accountability profiles (§5.2)
- [ ] `P2.2.1` Pluggable profile framework: creative-deliverable-SLA, response-SLA, outcome/target, coverage, none ⚠️(OD 7)
- [ ] `P2.2.2` Profiles attached to resource types; capacity + billing untouched when a profile swaps
- [ ] `P2.2.3` Non-creative thin surfaces (support/sales/event) matched to their accountability type

### P2.3 — SLA → performance linkage (§5.5)
- [ ] `P2.3.1` Append-only SLA event log: deadline set/changed (by whom), pauses (why), delivery — immutable + auditable
- [ ] `P2.3.2` ⚠️(OD 6) Aggregation policy → scoring implementation (granular data model already supports any policy)
- [ ] `P2.3.3` Anti-gaming counterweights: pause/deadline changes as visible reversible claims; gaming-visibility reports
- [ ] `P2.3.4` ⚠️(OD 13) Cross-tenant performance attribution on joint work
- [ ] `P2.3.5` Export/interface to the rewards system

### P2.4 — Tier-3 health dashboards (§6.4)
- [ ] `P2.4.1` Department health: on-time rate, at-risk/breached %, approval throughput, capacity load, blocked volume
- [ ] `P2.4.2` Company health: cross-department aggregation + systemic-bottleneck patterns
- [ ] `P2.4.3` Full drill-down: company → department → exception → single blocked task + responsible person (§6.5)
- [ ] `P2.4.4` ⚠️(OD 11) Honest-health design: hidden problems made more visible, not less (§6.6)

### P2.5 — Client portal: planning calendar (§10.2, OD 22 — post-portal phase)
- [ ] `P2.5.1` Annual shared calendar: firm / provisional / recurring entries (reservation-series pattern)
- [ ] `P2.5.2` Backward planning: commence-by = agreed end date − (work-type lead time + client feedback buffer)
- [ ] `P2.5.3` ⚠️(OD a–d in §10.2) Provisional-entry lead time, reminder escalation ladder, entry ownership (client proposes / AM confirms), forecast weighting
- [ ] `P2.5.4` Reminder engine: client nudged in portal first, then AM; concrete message with dates
- [ ] `P2.5.5` Blown commence-by → logged timestamped event feeding SLA attribution (compression provably client-caused)
- [ ] `P2.5.6` 🔒 Meridian-only aggregate demand forecast (retainer baseline + provisional + historical cadence gaps); client sees only its row
- [ ] `P2.5.7` Planning ↔ campaign calendar reference links (context only, never sync)

### P2.6 — Media lifecycle & storage tiering (§8.3)
- [ ] `P2.6.1` ⚠️(OD 15/16) Retention policy from agency contracts/legal: master window + intermediate-version policy — **ADR-0023** sets the operational intermediate default (internal rounds → per-tenant archive 60d after delivery/supersession); this task stays the *contractual* master/intermediate policy
- [ ] `P2.6.2` Nightly tier-transition job: hot → cold → proxy-only by status and age
- [ ] `P2.6.3` Proxy generation for superseded versions; metadata history permanent in Postgres regardless — **ADR-0023**: internal rounds archived to the per-tenant store (cloud or local) after 60d; `media_records` + `review_feedback` metadata kept permanently regardless of byte location

### P2.7 — Collabora edit-event patch (§8.4, OD 29)
- [ ] `P2.7.1` Read LibreOfficeKit source: establish what the server knows at broadcast (slide identity vs. object/coords) **before estimating**
- [ ] `P2.7.2` Scope narrow patch: which slide changed + who, per interval — not per keystroke
- [ ] `P2.7.3` Webhook → append-only audit row (user, document, slide, timestamp) alongside §5.5 events
- [ ] `P2.7.4` Attempt upstreaming early ("emit edit events for integrators") — the only exit from permanent rebase cost (§13)
- [ ] `P2.7.5` Fallback decision point: if upstreaming fails and rebase cost unsustainable → session correlation with audit-grade claim withdrawn (product decision, taken knowingly)

### P2.8 — Cross-tenant collaboration hardening
- [ ] `P2.8.1` 🔒 Full adversarial audit of joint-project + portal RLS with production-shaped data
- [ ] `P2.8.2` Per-customer configuration surfaces (SLA profiles, capacity rules, approval workflows, work types) — commercialization readiness (§10.3)
- [ ] `P2.8.3` Tenant data export (clean ownership, portable data)

### P2.9 — Deferred (build only on proven demand)
- [ ] `P2.9.1` Tier-3 media review: frame-accurate stepping, freehand annotation, pro codecs (§8.2)
- [ ] `P2.9.2` Frame.io deep API integration (only if link-out proves insufficient — OD 18)
- [ ] `P2.9.3` SpacetimeDB real-time layer (only if consolidation provably fails — §7.2 escape-hatch trigger)
- [ ] `P2.9.4` Multi-parent stream co-ownership (only if cross-campaign work proves common — §8.1)
- [ ] `P2.9.5` Configurable per-customer role surfaces (from fixed v1 views — §2.4)

---

## Open-Decision Gate Table (§11)

| OD | Status (v15) | Blocks |
|----|--------------|--------|
| 1 | Open — highest leverage | P2.1, P2.2 |
| 2 | Effectively resolved by §12 phasing (accountability surfaces = Phase 2, schema day-one) | — |
| 3 | **Resolved** — shared-schema-with-RLS | — |
| 4 | Open (leaning: scope-change events) | P2.1.4 |
| 5 | Open (leaning: self-service, visible reversible claim) | M7.3, P2.1.5 |
| 6 | Open | P2.3.2 |
| 7 | Open | P2.2.1 |
| 8 | **Resolved** — no billing engine; Odoo export (§9.5) | — |
| 9 | **Resolved** — ADR-0008: configurable RBAC (roles/grants as data) | L1.8–L1.11 |
| 10 | Open (leaning: both) | V1.5.4 |
| 11 | Open | P2.4.4 |
| 12 | **Resolved** — single nominal host | — |
| 13 | Open | P2.3.4 |
| 14 | Open — verify under load | V1.6.5 |
| 15 | Open — needs agency/legal input; **ADR-0023** sets the operational intermediate default (60d → per-tenant archive), contractual master/intermediate policy still open | P2.6.1 |
| 16 | Open — needs agency input; scoped by **ADR-0023** as above (contractual master/intermediate policy) | P2.6.1 |
| 17 | Open — needs editor-workflow input | V1.8.4 |
| 18 | Open (start link-out) | V1.8.5 |
| 19 | **Resolved (v15)** — milestone/stream-level approval | — |
| 20 | **Resolved (v15)** — milestone + go-live dates only | — |
| 21 | Open — resolve at dev-plan time | M10.1 |
| 22 | **Resolved (v15)** — campaign calendar MVP; planning calendar post-portal | — |
| 23 | Open — awaiting Finance template | V1.3.5 |
| 24 | Open (leaning: scheduled push + manual re-run) | V1.3.4 |
| 25 | **Partially resolved — ADR-0023** (forced version snapshot at client delivery); per-save session-collapse still leaning | V1.9.4 |
| 26 | Open — superseded by OD 29 if patch proceeds | V1.9.1 |
| 27 | Open — needs real answer before external recording | V1.10.2 |
| 28 | Open — untested; spike required | V1.10.1 |
| 29 | Open — read source before estimating | P2.7 |
| 30 | Open — local vs cloud storage residency, general (recordings decided via OD 27/ADR-0016); **advanced by ADR-0023** — archive residency is now per-tenant data (cloud or local); **carve-out by ADR-0044 (Edward, 26 Aug): creative-brief text may leave the tenant for inference — briefs only, on the basis that a brief carries no commercial data; rates, costs, contracts and media are NOT covered**; general active-store residency still open | INF.1, I14.3 |
| 31 | Open — company/industry news feed content source (manual posts vs external/RSS pull) | M7.4 |

## Standing watch-items (§13 — review every phase exit)

- [ ] Role-scope leakage check (every new feature)
- [ ] Copyleft **and paid-license** filter on every new dependency (paid deps require explicit authorization — see `0.1.6`)
- [ ] RLS adversarial tests green (joint-project + portal paths)
- [ ] Documentation current (single-point-of-knowledge mitigation)
- [ ] Collabora fidelity re-test on upgrade; LiveKit/coturn health
- [ ] Finance export figures reconcile against a locked period
- [ ] **Edge Function dependency lockfile — decide whether to adopt one** (raised 29 Aug, Edward).
  `supabase/functions/` has **no `deno.lock`**, so every deploy resolves `npm:zod@4`,
  `npm:@supabase/supabase-js@2` and the `esm.sh` imports to whatever is current at that moment. The
  frontend pins via `package-lock.json`; `AGENTS.md` §6 lists a committed lockfile under supply
  chain, so the functions are the inconsistency. **Impact to weigh before adopting:** a lockfile
  turns a shifted upstream dependency from a silent behaviour change into a loud CI failure — which
  is the point, and also a new way for a green branch to go red without anyone changing code. It
  also has to be regenerated deliberately whenever a function's imports change. Decide *when* (a
  quiet period, not mid-phase) as much as *whether*. Note: running `deno check` locally writes a
  `deno.lock` into the repo root as a side effect — delete it, or the decision gets made by
  accident.
