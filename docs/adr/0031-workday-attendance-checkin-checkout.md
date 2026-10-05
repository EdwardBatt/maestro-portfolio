# ADR-0031: Workday attendance — check-in / check-out on the SLA spine

- **Status:** **accepted** (I9 backend shipped; decisions below resolved per Edward's "continue with I9")
- **Date:** 2026-08-18
- **Relates to:** **ADR-0029** (SLA profiles — this reuses the *expected → actual → deviation* spine; and KPIs — attendance deviations are candidate signals), **ADR-0030** (per-task time tracking — attendance is *presence*, distinct from task work; the two together give utilisation), **ADR-0013** (people & culture / leave authority — leave days suppress attendance deviations), **ADR-0018** (health dashboards — where deviations surface). Design doc §8/§10 (categorized SLA engine; append-only audit; anti-gaming).
- **Task(s):** proposed block **I9** (attendance). Depends on ADR-0029's SLA-profile pattern; otherwise independent.

## Context

Edward: *"we need to track when users log in for the day and somehow track when they complete their day… this one is more challenging,"* and *"consider how the SLA system can be used to drive the check-in/check-out behaviour."* So attendance is not a bespoke feature — it's **another SLA-shaped thing**: an **expected** value (be in by 9, ~8h day), a **measured** actual (when you actually checked in/out), and a **tracked deviation** (late, short, missing) that feeds the same health/KPI picture. Reusing that spine keeps one mental model and one set of mechanics.

The genuinely hard part is **end-of-day**: check-in is a clean signal (first sign-in), but "completing the day" has no reliable event — people close a laptop without telling the system.

## Decision

### 1. Attendance profile (an SLA-shaped expectation)

Mirrors `sla_profiles` (ADR-0029): a reusable expectation resolved per person.

```sql
create table attendance_profiles (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  name              text not null,
  expected_check_in time,                       -- e.g. 09:00 (null = no fixed start)
  expected_minutes  int,                         -- expected worked minutes/day, e.g. 480
  grace_minutes     int not null default 0,      -- lateness grace before it's a deviation
  workdays          int[] not null default '{1,2,3,4,5}',  -- ISO dow (1=Mon); non-workdays never deviate
  is_default        boolean not null default false,
  created_by        uuid references user_profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, name)
);
create unique index uq_attendance_profile_default on attendance_profiles (tenant_id) where is_default;
```

Resolution: a person's profile → the tenant default. (Per-team/role assignment is a small extension; tenant default covers the pilot.)

### 2. Attendance day (the measured actual)

```sql
create table attendance_days (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  user_id           uuid not null references user_profiles(id),
  work_date         date not null,
  checked_in_at     timestamptz,
  checked_out_at    timestamptz,
  check_in_source   text check (check_in_source in ('auto','explicit')),
  check_out_source  text check (check_out_source in ('explicit','inferred')),
  worked_minutes    int,                          -- checked_out − checked_in (minus nothing this slice)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, user_id, work_date)
);
```

- **Check-in — automatic (my lean).** The first authenticated session of a workday stamps `checked_in_at`, `check_in_source='auto'`. Frictionless, and it *is* "when they log in for the day." The person sees their check-in time and the expected time; an explicit "Start day" is offered as an override if they were online earlier for something unrelated.
- **Check-out — hybrid, and this is the crux.** Preferred path: an explicit **"End day"** action (`check_out_source='explicit'`). Fallback when they forget: a **nightly cutoff job** closes any still-open day using the **last recorded activity** timestamp, stamping `check_out_source='inferred'`. The `inferred` mark is a **soft process-adherence flag** (like ADR-0030's manual-hours flag) — visible, honest, no automated penalty. This is the only design that survives real behaviour: rely on the explicit signal, degrade gracefully, and never silently invent a clean clock-out.

### 3. Deviations (computed, SLA-style)

A pure resolver `app.attendance_deviation(day)` returns the flags, never stored:

- **late** — `checked_in_at` later than `expected_check_in + grace_minutes`.
- **short** — `worked_minutes < expected_minutes`.
- **missing** — a workday with no check-in.
- **no-checkout** — closed by inference (`check_out_source='inferred'`).

Deviations are **suppressed** on non-workdays, tenant holidays/blackouts, and days the person is on approved **leave** (ADR-0013) — so the signal is real, not noise.

### 4. Reads are scoped (personnel-sensitive), like KPIs

`attendance_days` is **not** tenant-wide-readable. A row is read by the **person**, their **Team Leader** (team) and **Department Lead** (department) via the scope helpers, HR/`health:view`, and power admin. Peers never see each other's attendance. Writes: check-in/out are self-service (your own row); the nightly close runs service-role. All audited.

### 5. Ties to the rest

- **Utilisation** (a KPI signal, ADR-0029): `sum(task minutes)` (ADR-0030) ÷ `worked_minutes` (here) — how much of a present day went to tracked task work. Derived, later.
- **Notifications (optional, later):** a gentle "you didn't check out yesterday" nudge; not required for v1.

## Consequences

**Easier:** attendance rides the SLA spine already being built (ADR-0029) — one pattern, not a new subsystem; check-in is free (first sign-in); deviations feed the same health/KPI surfaces; and leave/holiday suppression keeps the numbers honest.

**Harder / new:** end-of-day is intrinsically unreliable — the inferred fallback + nightly close is the pragmatic answer but must be clearly flagged so an inferred checkout is never mistaken for a real one; a nightly job needs a scheduler (no `pg_cron` yet — same gap as the `due_soon` sweep, so this shares that dependency); "last activity" needs a cheap heartbeat (a lightweight `last_seen_at` on the session/profile) to infer from; and attendance is personnel data, so the scoped-read predicate must be exactly right.

**Explicit non-goals (P2 / later):** automated penalties for late/short/missing (visibility only); geofencing / device attestation; break tracking; overtime calc; per-team/role profile assignment beyond the tenant default.

## Resolved decisions (were "open"; locked at I9 build)

1. **Check-in:** **automatic** on first heartbeat of the workday (`check_in_source='auto'`), with an explicit **`app.attendance_start_day()`** override that promotes an earlier auto stamp to `explicit`.
2. **End-of-day fallback:** **nightly cutoff using last activity** — `app.attendance_nightly_close(date)` infers the checkout from `attendance_days.last_activity_at` (falling back to check-in) and flags `check_out_source='inferred'`. Never a silent clean clock-out.
3. **Expected model:** **expected minutes/day** drives the `short` flag; the profile *also* carries `expected_check_in` + `grace_minutes` for the `late` flag (both, leaning on minutes for the day length).
4. **Scheduler:** left as a **deploy-time choice** — the nightly close is a callable `service_role` function (grant restricted), triggered by an external cron → Edge Function (mirrors `notify-email`) or `pg_cron` later. Not baked into the migration, so this does not block on standing up a scheduler.

Implementation notes (I9): profile management reuses **`leave:manage`** (HR, ADR-0013) — no new grant, no seeder change; the scoped read reuses **`team:view` + the scope helpers** for the lead chain, plus `leave:manage`/`health:view` for HR/execs. To avoid audit spam, `attendance_days` is deliberately **not** on the universal audit trigger (a heartbeat every few minutes would swamp `audit_events`); `attendance_profiles` is audited. Deviation `late` compares check-in time in **UTC** for now — tenant-timezone handling is a later refinement. Deferred (non-goals, unchanged): automated penalties, geofencing, break/overtime tracking, per-team/role profile assignment.

## Bookkeeping (applied at I9)

Row **0031** → `docs/adr/README.md`; **I9** block in `docs/TASKS.md`; cross-references ADR-0029 (SLA spine reused) and ADR-0030 (utilisation).
