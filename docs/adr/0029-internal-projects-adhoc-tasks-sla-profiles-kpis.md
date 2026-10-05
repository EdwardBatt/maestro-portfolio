# ADR-0029: Internal projects, booking-based assignment (sub-task & ad-hoc), reusable SLA profiles, and customisable KPIs

- **Status:** **accepted** (Edward, 2026-08-19)
- **Date:** 2026-08-18
- **Relates to:** **ADR-0008** (grant-driven RBAC; `role_grants`, `app.has_permission`, role `scope`, `app.in_write_scope`), **ADR-0009** (Department Lead / Team Leader, Account-Manager assignment on clients/campaigns), **ADR-0010** (deliverable → sub-task breakdown; scoped write authority), **ADR-0020/0021** (campaign/job model, client registration), **ADR-0024** (Phase I; *"full accountability engine (P2) deferred, SLA manual now"* — this ADR pulls a **scoped slice** of P2 forward), **ADR-0018** (grant-driven dashboards; health tier — where KPIs surface).
- **Design doc:** §"a campaign *is* a project"; §work types carry *"its own SLA profile, KPIs, and owners"*; §9 *"Accountability profiles — the pluggable per-role measurement framework (creative-SLA, sales-target, event-coverage, response-SLA, none)"*; §8 *"Categorized SLA engine — work-type-driven profiles"*; §10 *"SLA-to-performance linkage"*.
- **Task(s):** proposed new block **I7** (see Phased plan). Supersedes nothing.

## Context

Two capabilities are missing, and they share a spine (internal work + how it's measured):

1. **Leads need to run internal work.** Department Leads and Team Leaders must be able to create **internal projects** — real projects (with deliverables and sub-tasks *where appropriate*) whose "client" is **internal** (the tenant, a department, or a team), not an external client. Today `jobs.client_id` and `campaigns.client_id` are **NOT NULL** and reference external `clients`, so there is no legal way to own a project internally.

2. **Assignment on the calendar is under-modelled, and ad-hoc work has no home.** A deliverable is broken into **sub-tasks**, and each sub-task can be assigned to any human resource. Assigning a resource **is** a booking on the calendar — and it must be doable from either end (from the deliverable, or from the calendar/bookings page by picking a resource and creating/assigning the sub-task there). Two problems today: (a) `bookings` reference `deliverable_id`/`job_id` but **have no `sub_task_id`**, so a booking cannot point at a sub-task — despite ADR-0024's intent that *"sub-tasks materialise as bookings"*; the booking "task" picker only lists **deliverables**. (b) There is no **ad-hoc** booking — a slot dropped directly on a resource with no deliverable/sub-task behind it (**client ad-hoc** = linked to client work; **direct ad-hoc** = internal, no client). And **booking assignment does not notify** the booked person at all (only sub-task assignment / deliverable state changes notify — ADR-0028 family). All three — sub-task, deliverable, ad-hoc — must be assignable, visible/tracked on the calendar, and must notify the resource.

Layered on both: leads want **customisable KPIs and SLAs** on this work. The design doc already frames this precisely — work types carry an **SLA profile** and **KPIs**, and §9 defines pluggable **accountability profiles**. ADR-0024 deferred the *full* P2 accountability engine (attribution, pausable/attributable clock, rewards, anti-gaming). This ADR pulls a **bounded slice** forward: **reusable SLA profiles** and **customisable KPIs (manual + event-derived)** attachable to projects — *without* the rewards/attribution/anti-gaming machinery, which stays P2.

### Decisions taken with Edward (2026-08-18)

- **No nullable owner.** A project's owner must never be empty — a missing client would break scoping, SLA, and AM resolution across the system. Internal ownership is a **filled** value, not an absent one.
- **Internal owner = an "internal client" record** (the tenant/department/team registered as a first-class internal client). `client_id` stays **NOT NULL everywhere**; all downstream machinery (deliverables, sub-tasks, SLA, `app.deliverable_account_manager`, RLS) is unchanged.
- **The booking IS the assignment record — no separate ad-hoc table.** Assigning a resource to a sub-task (or a deliverable) is a booking on the calendar, creatable from either the deliverable or the calendar itself. An **ad-hoc** booking is the same act with no deliverable/sub-task, carrying its own **title + note**. So `bookings` gains `sub_task_id` + `title`, and **booking assignment notifies the booked resource** — for sub-task, deliverable, and ad-hoc alike. (Corrects my earlier `ad_hoc_tasks`-table proposal, which Edward rejected: ad-hoc is a booking, not a new entity.)
- **Internal project = a light `job`** — it can carry deliverables and sub-tasks, but **does not require a campaign** (`jobs.campaign_id` is already nullable). Its "client" is an internal client (above) (Edward, 2026-08-18).
- **KPIs are measured on the individual and roll up** — individual → team (`user_profiles.team_id`) → department (`teams.department_id`). Both manual and event-derived. **Measurement/visibility only this slice; reward/pay linkage + anti-gaming stay P2** (Edward, 2026-08-18).
- **SLAs are reusable profiles per work type.**

## Decision

### Part 1 — Internal projects via internal-client records

Add to `clients` (nothing becomes nullable):

```sql
alter table clients add column is_internal boolean not null default false;
alter table clients add column internal_kind text
  check (internal_kind in ('tenant','department','team'));
alter table clients add column internal_department_id uuid references departments(id);
alter table clients add column internal_team_id uuid references teams(id);
-- exactly-one integrity: external clients carry none of it; internal clients carry a coherent owner
alter table clients add constraint chk_clients_internal_shape check (
  (not is_internal and internal_kind is null and internal_department_id is null and internal_team_id is null)
  or (is_internal and internal_kind = 'tenant'     and internal_department_id is null and internal_team_id is null)
  or (is_internal and internal_kind = 'department' and internal_department_id is not null and internal_team_id is null)
  or (is_internal and internal_kind = 'team'       and internal_team_id is not null and internal_department_id is null)
);
-- one internal-client identity per org unit (get-or-create is race-safe)
create unique index uq_clients_internal_tenant     on clients (tenant_id) where is_internal and internal_kind = 'tenant';
create unique index uq_clients_internal_department on clients (tenant_id, internal_department_id) where internal_kind = 'department';
create unique index uq_clients_internal_team       on clients (tenant_id, internal_team_id) where internal_kind = 'team';
```

- **An internal project is a `job`** whose `client_id` points at an internal client. `jobs` → `deliverables` → `sub_tasks` and the whole SLA/notification/AM stack work **unchanged**. (Campaigns stay external-strategy vehicles; internal work uses the lighter job shape, which already supports deliverables via `deliverables.job_id`.)
- **`account_manager_id`** on an internal client defaults to the creating lead (a Team Leader/Department Lead plays the AM role for internal work). `app.deliverable_account_manager` already resolves through `job → client → account_manager_id`, so internal-project deliverable notifications route to that lead with **no change** to the resolver.
- **Fencing:** external-client surfaces (client registration list, client reporting, portal) filter `where is_internal = false`. Internal clients never appear as external clients. (A helper `app.is_internal_client(uuid)` or a plain predicate; reads stay tenant-scoped as today.)

**Authority (RBAC, ADR-0008) — set up by the Traffic Manager / Power Admin; run by an appointed PM (Edward, 2026-08-19).**

- **Setup** (create the internal project) is the **Traffic Manager** (the Scheduler role's official title — renamed here) and **Power Admin**. Both already hold org-wide `projects:manage`, and the *existing* `jobs` write policy already lets a tenant-scoped role create a job for any client (internal or not) — so there is **no new grant and no `jobs`-policy change**. Department/Team Leads do **not** set up internal projects (an earlier draft gave them a dedicated grant; reversed — leads stay bounded to their own patch).
- **A Project Manager is appointed per internal project** — the job's `owner_user_id`. The PM gets **project-scoped** manage authority over *their* project's `sub_tasks` (a new `app.caller_is_project_pm(deliverable)` branch added to the sub-task manage policies), so they coordinate the work **across every department the project touches** without org-wide admin rights and without each department's lead running a separate slice. This is the clean answer to multi-department internal projects: ownership is single, the PM reaches across. (Booking-level PM authority lands with I7.2; PM-driven deliverable transitions are a noted follow-up. Sign-off stays with reviewers.)
- **Role rename:** the `scheduler` role keeps its key (stable for claims/policies) but is retitled **"Traffic Manager"** everywhere it's displayed.

### Part 2 — The booking is the assignment record (sub-task, deliverable, or ad-hoc)

No new table. A **booking** already ties a resource to a time; it becomes the single assignment record for all three cases. Extend `bookings`:

```sql
alter table bookings add column sub_task_id uuid references sub_tasks(id) on delete cascade;
alter table bookings add column title text;   -- required for ad-hoc; null for linked bookings (label derives from the entity)
create index idx_bookings_sub_task_id on bookings (sub_task_id);
-- a booking is exactly one of: a sub-task assignment, a deliverable-level allocation, an ad-hoc slot
alter table bookings add constraint chk_bookings_assignment_shape check (
  (sub_task_id is not null)                                             -- sub-task booking (deliverable implied via the sub-task)
  or (sub_task_id is null and deliverable_id is not null)               -- deliverable-level booking
  or (sub_task_id is null and deliverable_id is null and job_id is not null)  -- job/project-level booking
  or (sub_task_id is null and deliverable_id is null and job_id is null and title is not null)  -- ad-hoc: title required
);
```

**The two entry points write the same record.** Assigning is one action reachable from either side, and both converge on: *(the sub-task exists with `assignee_id`) + (a booking rows the resource onto the calendar, `sub_task_id` set)*.

1. **From the deliverable** — pick/lay out sub-tasks, assign a resource → creates/updates the sub-task's `assignee_id` and its calendar booking.
2. **From the calendar/bookings page** — pick a resource + timeslot, then pick a deliverable and **pick or create a sub-task** under it → writes the sub-task (with `assignee_id` = the resource's user) *and* the booking together, in one service-side action. (This is why `bookings` needs `sub_task_id`: the calendar is now a first-class place to create sub-task assignments, per the design — "we should be able to assign the resource then the sub-task is created.")

A **deliverable-level** booking (no sub-task chosen) stays supported for coarse allocation. An **ad-hoc** booking has no deliverable/sub-task and carries `title` + `notes`; **client ad-hoc** vs **direct ad-hoc** is simply whether it also links a `job_id`/client or not (nothing new — the existing nullable `job_id` already encodes that).

- **Resource ↔ user:** a booking assigns a `resource`; human resources map to a `user_profile` (ADR-0011). The assignment/notification target is that user; equipment resources don't notify.
- **Notifications — the booked person is told, for all three:**
  - **Sub-task bookings** ride the **existing** sub-task assignment emission (`assigned`, entity_type `sub_task`) — setting `assignee_id` already notifies (I5a). The booking trigger **skips** when `sub_task_id is not null`, so there's **no double-notify**.
  - **Deliverable-level and ad-hoc bookings** (no sub-task to carry it) get a new booking emission trigger `app.tg_booking_notify_resource`: on insert / resource change, notify the booked resource's user (actor excluded), `label` = the deliverable name or the ad-hoc `title`. Needs `'booking'` added to `notifications.entity_type`, plus inbox `href()` + `notify-email` `deepLink()` → the **task action surface** where Start/Submit live (ADR-0030) — a sub-task goes to its action view (e.g. `/my-work?task={sub_task_id}`), a deliverable/ad-hoc booking to its own view — and one copy entry (or reuse `assigned`).
  - Principle: **one notification per assignment event**, carried by the sub-task when there is one, by the booking when there isn't.
- **Visibility/tracking:** sub-task, deliverable, and ad-hoc bookings all render on the calendar/grid and consume capacity exactly as bookings do today; `taskName` on the schedule row resolves from the sub-task title → deliverable name → ad-hoc `title`.
- **Authority:** creating bookings is the existing `bookings:create` grant + scope; creating the sub-task from the calendar rides `project_tasks:manage` (already held by leads and schedulers). Ad-hoc bookings need no new grant.

### Part 3 — Reusable SLA profiles per work type

```sql
create table sla_profiles (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  name           text not null,
  work_type_id   uuid references work_types(id),   -- the discipline this profile is for (nullable = generic)
  turnaround_hours numeric(6,2) check (turnaround_hours is null or turnaround_hours > 0),
  -- type-specific hard-deadline derivation kept declarative + small for this slice
  deadline_rule  jsonb not null default '{}'::jsonb,   -- e.g. {"from":"assigned","business_hours":true}
  is_default     boolean not null default false,       -- default profile for its work type
  created_by     uuid references user_profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, name)
);
create unique index uq_sla_profile_wt_default on sla_profiles (tenant_id, work_type_id) where is_default;
```

- **Attach points:** a nullable `sla_profile_id` on `jobs` (project-level) and `sub_tasks` (leaf). **Resolution order:** sub-task's `sla_profile_id` → project's `sla_profile_id` → the work type's default profile → tenant default. A pure resolver `app.effective_sla(...)` returns the applicable turnaround; the **existing** `sub_tasks.sla_hours` remains the manual override at the leaf. (Ad-hoc bookings can carry a `work_type_id` and thus pick up its default profile; no SLA plumbing is required for a quick ad-hoc slot.)
- **Scope for this slice:** profiles carry turnaround + a simple `deadline_rule`. The **pausable/attributable clock, attribution, and rewards stay P2** (ADR-0024). We are adding *configurable targets*, not the accountability engine.
- **Reused for attendance (forward note).** The "expected target → measured actual → tracked deviation" spine here is the same shape **ADR-0031** (workday attendance / check-in-out) will reuse — an attendance profile sets expected check-in/hours, the clock-in/out captures the actual, and lateness/short-days surface as deviations. One mechanism, two uses; consequences stay P2.
- **Authority:** managing profiles = a new `sla_profiles:manage` grant (leads + power admin); reads tenant-wide.
- **Implementation note (I7.3):** the shipped resolver `app.effective_sla(sub_task)` walks six tiers, top wins: (1) `sub_tasks.sla_hours` manual leaf override; (2) `sub_tasks.sla_profile_id`; (3) the deliverable's `jobs.sla_profile_id` (project); (4) the work type's **explicitly-assigned** `work_types.sla_profile_id` (the pre-existing column, honoured ahead of the default so it is not dead); (5) the `is_default` profile for that work type; (6) the `is_default` profile with `work_type_id` null (tenant default, earliest wins since the partial-unique index does not constrain null work types). A tier whose profile carries a null `turnaround_hours` falls through; the resolver returns null when nothing sets one.

### Part 4 — Customisable KPIs: measured on the individual, rolled up to team → department

```sql
create table kpi_definitions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  name         text not null,
  unit         text,                                  -- 'posts','%','hours',…
  source       text not null check (source in ('manual','derived')),
  metric_key   text,                                  -- derived only: 'on_time_pct'|'throughput'|'avg_rounds'|'blocked_hours'|…
  work_type_id uuid references work_types(id),        -- optional scoping to a discipline
  higher_is_better boolean not null default true,
  aggregation  text not null default 'avg' check (aggregation in ('avg','sum','weighted')),  -- how individuals roll into team/dept
  formula      jsonb not null default '{}'::jsonb,    -- bounded weighted formula over the signal catalogue (admin-editable; see below)
  created_by   uuid references user_profiles(id),
  created_at   timestamptz not null default now(),
  unique (tenant_id, name)
);

-- The measured record lives on the INDIVIDUAL. Team + department figures are computed rollups (below),
-- not stored — so there is one source of truth and nothing to keep in sync.
create table kpi_targets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  kpi_definition_id uuid not null references kpi_definitions(id) on delete cascade,
  user_id       uuid not null references user_profiles(id) on delete cascade,  -- the individual
  period_start  date not null,
  period_end    date not null,
  target        numeric,
  actual        numeric,                               -- manual: entered; derived: computed
  actual_source text not null default 'manual' check (actual_source in ('manual','derived')),
  updated_by    uuid references user_profiles(id),
  updated_at    timestamptz not null default now(),
  unique (kpi_definition_id, user_id, period_start, period_end)
);
```

- **Individual is the unit.** A target + actual is set per person, per KPI, per period. Manual (`source='manual'`, lead/person enters `actual`) now; derived (`source='derived'` + `metric_key`, a computation fills `actual` from SLA/delivery events) is the Phase-2 seam back to P2 — same table, `actual_source='derived'`.
- **Rollup is computed, not stored.** A resolver/view `app.kpi_rollup(period)` aggregates each definition over the org chain: **team** = aggregate of its members' individual `actual`/`target` (members via `user_profiles.team_id`), **department** = aggregate over its teams (`teams.department_id`), using the definition's `aggregation` (`avg` for rates like on-time %, `sum` for counts like posts). So "individual → team → department" is one derivation, always consistent with the individual rows. (Independently-set team/department *targets* — a lead saying "the team should hit X" regardless of the member average — are a noted later extension, not this slice.)
- **Visibility is scoped — individual KPIs are sensitive, NOT tenant-wide.** Unlike work rows, a person's KPI is read by: **themselves**; their **Team Leader** (their team) and **Department Lead** (their department) via the existing scope helpers; and `health:view`/power admin. **Peers do not see each other's individual KPIs.** Rollups (team/department aggregates) are visible to the corresponding lead and up.
- **Authority:** defining KPIs + setting targets/actuals = `kpi:manage`, scoped — a Team Leader manages their team's individuals, a Department Lead their department's, power admin all.
- **Where they surface:** a personal scorecard (your KPIs vs target), a lead's team/department rollup with per-member drill-down, and the **Tier-3 health dashboard** (ADR-0018) — `higher_is_better` drives colouring.
- **Admin-configurable, bounded formula (Edward).** KPIs are tunable from the admin dashboard so the numbers can be adjusted as the system is used, to **drive the desired behaviour** — but the formula is **bounded, not free-form**. The system exposes a fixed **signal catalogue** (e.g. `on_time_pct`, `throughput`, `rework_rounds`, `started_ahead_count`, `timer_compliance`, `wait_time`, `avg_review_rounds`), and a KPI's `formula` is a **weighted combination + thresholds + target** over those signals (the weights *are* the behaviour levers). This stays safe and testable — no arbitrary expression language to parse or sandbox. (A free-form expression editor was explicitly rejected; it can be revisited later if the bounded form ever feels too tight.) Admins with `kpi:manage` edit definitions/weights; changes are audited.
- **Implementation note (I7.4):** the shipped read-restriction is two SECURITY DEFINER predicates — `app.caller_can_read_kpi(subject)` (self OR `health:view` OR a `kpi:manage` holder whose `in_write_scope` covers the subject's team→department) and `app.caller_can_manage_kpi_target(subject)` (the same scope check for writes). `kpi_definitions` stays tenant-wide-read (catalogue), write-gated on `kpi:manage`. Rollups: `app.kpi_rollup(start,end)` aggregates individuals→team, then teams→department (a department mean is the mean of its **team** means, not re-averaged individuals), SECURITY INVOKER so RLS scopes the underlying rows to the caller. **Deferred (noted):** self-service *actual* entry ("person enters own actual") — this slice keeps all target/actual writes lead-scoped (`kpi:manage`); letting a subject update only their own `actual` is a thin column-guarded follow-on, not built here.
- **Guardrail (the P2 boundary):** this slice is **measurement and visibility only**. Person-level numbers here inform; they are **not** wired to pay, ranking, or automated judgement, and the anti-gaming counterweights the design doc calls for (§10) land with the full P2 accountability engine. Building the measurement now without that linkage is deliberate — it gives leads visibility without turning an un-safeguarded metric into a reward function.

### Cross-cutting: notifications, audit, RLS, i18n

- **Notifications:** add `'booking'` to `notifications.entity_type`; add the booking-assignment emission trigger (fires only when `sub_task_id is null`, so sub-task bookings aren't double-notified); extend inbox `href()` + `notify-email` `deepLink()` + copy maps to the calendar/booking. (No change to the transport — ADR-0015/0026/0028 stand.)
- **Audit:** `sla_profiles`, `kpi_definitions`, `kpi_targets` get the universal `app.audit_row_change` trigger (L1.9); `bookings` is already audited.
- **RLS:** deny-by-default + force; grant-driven scoped writes exactly as ADR-0008. Reads are tenant-wide for work rows (bookings/sub-tasks) as today — **except `kpi_targets`, which is read-restricted** to the subject, their lead chain (team → department), and `health:view`/power admin (Part 4); peers never see each other's numbers.
- **i18n:** EN + AR for every new surface (RTL), per I6.2 discipline.

## Phased implementation plan (proposed block **I7**)

Each phase is its own migration set + tests + UI + ADR bookkeeping, shipped and CI-green before the next. Internal projects first (they unblock the rest), then ad-hoc tasks (closes the notification gap), then the measurement layer.

- **I7.1 — Internal clients + internal projects.** `clients` internal columns + constraints + get-or-create helper; **role rename** (Scheduler → Traffic Manager); **per-project PM** (`app.caller_is_project_pm` branch on the sub-task manage policies); external-surface fencing. **Setup authority uses the existing `projects:manage`** (Traffic Manager / Power Admin) — no new grant, no `jobs`-policy change. **Creation UI is NOT a new surface** — it's a new **"Internal" brief type in the existing Brief Wizard** (ADR-0020): step 1 gains the type; the client step becomes an internal-**owner picker** (tenant / department / team → get-or-create the internal client); brand/audience/strategy fields are skipped (as the ad-hoc type already does); the submit RPC is taught to resolve the internal owner and create the job via the `internal_projects:manage` path. Everything downstream (deliverables → sub-tasks → assignment) is unchanged. Tests: internal-client shape constraints, team-lead can create internal but not client project, AM resolves to the lead, fencing. 
- **I7.2 — Booking-based assignment + ad-hoc + notifications.** `bookings` gains `sub_task_id` + `title` + the assignment-shape constraint; the calendar create-flow gains a deliverable→sub-task drill-down (pick-or-create a sub-task) and an ad-hoc mode (title + note, optional client link); booking-assignment emission trigger (`entity_type='booking'`, skips sub-task bookings) + inbox/email deep-link/copy. Tests: assignment-shape constraint (sub-task / deliverable / job / ad-hoc), sub-task booking notifies via the sub-task path (no dupe), deliverable + ad-hoc bookings notify the resource's user (actor-excluded), cross-tenant isolation, email guard, calendar visibility of all three.
- **I7.3 — SLA profiles.** `sla_profiles` + attach points + `app.effective_sla` resolver + `sla_profiles:manage`; profile picker on projects/tasks. Tests: resolution order, work-type default uniqueness, leaf override precedence.
- **I7.4 — KPIs (manual, individual + rollup).** `kpi_definitions` (with `aggregation`) + `kpi_targets` (per individual) + scoped `kpi:manage`; the `app.kpi_rollup` resolver (team via `user_profiles.team_id`, department via `teams.department_id`); personal scorecard + lead rollup UI + health-dashboard surfacing. Tests: individual target/actual + period uniqueness; **read-scoping (self / team-lead / dept-lead / health:view; peer denied)**; rollup aggregation (avg vs sum) matches the member set; cross-tenant isolation.
- **I7.5 — KPIs (derived) [P2 seam].** `metric_key` computations fill individual `actual` from SLA/delivery events; scheduled refresh; rollups follow automatically. (Depends on the deadline sweep / event plumbing; lands with the broader P2 work — as does any reward/pay linkage + anti-gaming.)

## Consequences

**Easier:** internal work becomes a first-class, measurable citizen without weakening the "owner is always present" invariant; the whole deliverable/sub-task/SLA/AM/notification stack is reused unchanged for internal projects; assignment is **one record (the booking)** reachable from the deliverable or the calendar, so sub-task / deliverable / ad-hoc work is all visible, tracked, and notifying through one path — **no new assignable entity** to keep in sync; SLAs and KPIs become configurable per the design doc's own framework, with a clean seam to P2.

**Harder / new:** the `clients` table now carries internal rows (must be fenced from every external-client surface — a real, ongoing discipline, enforced by `is_internal = false` filters + tests); `bookings` grows an assignment-shape constraint and a two-path create-flow (deliverable-side and calendar-side must converge on the same sub-task + booking without racing or double-writing); the "one notification per assignment" rule depends on the booking trigger correctly deferring to the sub-task path (covered by a test); three new tables (`sla_profiles`, `kpi_definitions`, `kpi_targets`) and several grants; **individual KPIs are personnel-sensitive** — `kpi_targets` needs the app's first genuinely *read-restricted* table (self + lead-chain + `health:view`, peers denied), a departure from the tenant-wide-read norm, so the scope predicate must be exactly right; and person-level metrics invite gaming (design doc §10) — held off by keeping reward/pay linkage + anti-gaming enforcement in P2 (this slice measures and shows, nothing more).

**Explicit non-goals (stay P2 / later):** pausable/attributable SLA clock, attribution, rewards, anti-gaming enforcement; derived-KPI computations beyond the Phase-2 seam; `due_soon` scheduled sweep (already deferred).

### Settled (Edward, 2026-08-18)

- **Internal project = a light `job`** — carries deliverables/sub-tasks, does **not** require a campaign; client is an internal client.
- **Assignment = the booking** (sub-task / deliverable / ad-hoc); `bookings` gains `sub_task_id` + `title`; booking assignment notifies the booked resource; **no `ad_hoc_tasks` table**.
- **KPIs measured on the individual, rolled up individual → team → department**; measurement/visibility only (reward/pay + anti-gaming stay P2); `kpi_targets` is read-restricted to self + lead-chain + `health:view`.
- **Sequencing:** I6 first (now complete), then I7.
- **Internal-project setup = Traffic Manager (renamed from Scheduler) + Power Admin** via existing `projects:manage` (no new grant); each internal project appoints a **PM** (`jobs.owner_user_id`) with project-scoped sub-task authority across departments — Edward, 2026-08-19. (Reverses the earlier dept/team-lead `internal_projects:manage` grant.)
- **Task/booking notifications point at the task action surface** (Start/Submit — ADR-0030), not the calendar — Edward.
- **Task execution + time tracking** (Start Task/Submit lifecycle, per-sub-task timer, deliverable review gate) is its own **ADR-0030**, referenced here; SLA *actuals* (Part 3) and derived KPIs (Part 4) draw on the time it captures.

### Open

_None blocking — all decisions settled. Remaining detail lives in ADR-0030 (task execution)._

## On acceptance (bookkeeping to apply — not done yet)

Row **0029** → `docs/adr/README.md`; a new **I7** block in `docs/TASKS.md` (I7.1–I7.5); note in ADR-0024 that a scoped slice of its deferred P2 items is pulled forward here. Proposed first commit (git is Edward's): `docs: ADR-0029 internal projects, ad-hoc tasks, SLA profiles, KPIs [I7 plan]`.
