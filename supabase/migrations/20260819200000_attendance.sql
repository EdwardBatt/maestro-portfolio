-- ADR-0031 (I9): workday attendance on the SLA spine — expected → actual → deviation.
--
-- attendance_profiles is an SLA-shaped expectation (expected check-in, expected minutes/day, grace,
-- workdays) mirroring sla_profiles. attendance_days is the measured actual: auto check-in on the
-- first heartbeat of the day (explicit "Start day" override), explicit "End day", and a service-role
-- nightly close that infers a checkout from last activity when someone forgets — flagged
-- check_out_source='inferred' (a soft process-adherence marker, never a silent clean clock-out).
-- app.attendance_deviation is a pure resolver (late/short/missing/no-checkout), suppressed on
-- non-workdays, holidays and approved leave. attendance_days is personnel-sensitive: reads are
-- scoped (self / team-lead / dept-lead / HR / health:view / power admin), exactly like KPIs.
--
-- Decisions locked from ADR-0031's open questions (per Edward "continue with I9"): auto check-in
-- with explicit override; hybrid checkout with inferred nightly close; expected-minutes model; and
-- the nightly close is a callable service-role function so its trigger (external cron → Edge
-- Function, matching notify-email; or pg_cron later) is a deploy-time choice, not baked in here.
--
-- No new grant / no seeder change: profile management reuses leave:manage (HR, ADR-0013); the
-- lead-chain read reuses team:view + the scope helpers; HR/exec reads reuse leave:manage/health:view.
-- Activity churn (the heartbeat's last_activity_at) is deliberately kept OFF the universal audit
-- trigger — attendance_profiles is audited (low-churn config); attendance_days is not (a heartbeat
-- every few minutes would swamp audit_events); the row itself and its source flags are the record.

-- ---- 1. attendance profile: the SLA-shaped expectation ----
create table attendance_profiles (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  name              text not null,
  expected_check_in time,
  expected_minutes  int check (expected_minutes is null or expected_minutes > 0),
  grace_minutes     int not null default 0 check (grace_minutes >= 0),
  workdays          int[] not null default '{1,2,3,4,5}',   -- ISO dow (1=Mon)
  is_default        boolean not null default false,
  created_by        uuid references user_profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_attendance_profiles_tenant_name unique (tenant_id, name)
);
create unique index uq_attendance_profile_default on attendance_profiles (tenant_id) where is_default;
create index idx_attendance_profiles_tenant_id on attendance_profiles (tenant_id);

alter table attendance_profiles enable row level security;
alter table attendance_profiles force row level security;
-- the expectation is not personnel data: tenant-wide read, HR (leave:manage) writes.
create policy attendance_profiles_tenant_select on attendance_profiles
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy attendance_profiles_manage_write on attendance_profiles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('leave', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('leave', 'manage'));
create trigger set_updated_at before update on attendance_profiles
  for each row execute function app.set_updated_at();
create trigger audit_row_change
  after insert or update or delete on attendance_profiles
  for each row execute function app.audit_row_change();

-- ---- 2. attendance day: the measured actual (personnel-sensitive) ----
create table attendance_days (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  user_id           uuid not null references user_profiles(id),
  work_date         date not null,
  checked_in_at     timestamptz,
  checked_out_at    timestamptz,
  check_in_source   text check (check_in_source in ('auto','explicit')),
  check_out_source  text check (check_out_source in ('explicit','inferred')),
  worked_minutes    int,
  last_activity_at  timestamptz,                            -- heartbeat high-water mark; feeds the inferred close
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_attendance_days_user_date unique (tenant_id, user_id, work_date)
);
create index idx_attendance_days_tenant_id on attendance_days (tenant_id);
create index idx_attendance_days_user_id on attendance_days (user_id);
create index idx_attendance_days_open on attendance_days (work_date) where checked_out_at is null;

alter table attendance_days enable row level security;
alter table attendance_days force row level security;

-- Scoped read: self, HR (leave:manage), execs (health:view), or the subject's team/department lead
-- (team:view within write scope). SECURITY DEFINER so the subject's team/department lookup is
-- reliable regardless of the caller's own RLS. No client WRITE path — check-in/out flow only through
-- the SECURITY DEFINER RPCs below; the nightly close runs service-role.
create or replace function app.caller_can_read_attendance(p_subject uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select
    p_subject = auth.uid()
    or app.has_permission('health', 'view')
    or app.has_permission('leave', 'manage')
    or (
      app.has_permission('team', 'view')
      and app.in_write_scope(
        (select department_id from user_profiles where id = p_subject),
        (select team_id       from user_profiles where id = p_subject),
        null)
    )
$$;
comment on function app.caller_can_read_attendance(uuid) is
  'ADR-0031: may the caller read this subject''s attendance? self, HR (leave:manage), health:view/power admin, or the subject''s team/department lead (team:view within write scope). Peers: no.';

create policy attendance_days_scoped_select on attendance_days
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.caller_can_read_attendance(user_id));
create trigger set_updated_at before update on attendance_days
  for each row execute function app.set_updated_at();

-- ---- 3. self-service check-in/out RPCs (SECURITY DEFINER; write only your own day) ----
-- Heartbeat: called by the app on load / periodically. First call of a workday auto-checks-in;
-- every call advances last_activity_at (the signal the nightly close infers a checkout from).
create or replace function app.attendance_heartbeat()
returns void language plpgsql security definer set search_path = public, app as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from user_profiles where id = auth.uid();
  if v_tenant is null then raise exception 'no profile for caller' using errcode = 'P0002'; end if;
  insert into attendance_days (tenant_id, user_id, work_date, checked_in_at, check_in_source, last_activity_at)
  values (v_tenant, auth.uid(), current_date, now(), 'auto', now())
  on conflict (tenant_id, user_id, work_date)
  do update set last_activity_at = now();
end $$;

-- Explicit "Start day": overrides an earlier auto check-in (e.g. online earlier for something else).
create or replace function app.attendance_start_day()
returns void language plpgsql security definer set search_path = public, app as $$
declare v_tenant uuid; v_day attendance_days;
begin
  select tenant_id into v_tenant from user_profiles where id = auth.uid();
  if v_tenant is null then raise exception 'no profile for caller' using errcode = 'P0002'; end if;
  select * into v_day from attendance_days where tenant_id = v_tenant and user_id = auth.uid() and work_date = current_date;
  if v_day.id is null then
    insert into attendance_days (tenant_id, user_id, work_date, checked_in_at, check_in_source, last_activity_at)
    values (v_tenant, auth.uid(), current_date, now(), 'explicit', now());
  elsif v_day.checked_out_at is not null then
    raise exception 'the day is already closed' using errcode = '55000';
  elsif v_day.check_in_source = 'auto' then
    update attendance_days set checked_in_at = now(), check_in_source = 'explicit', last_activity_at = now()
      where id = v_day.id;
  else
    update attendance_days set last_activity_at = now() where id = v_day.id;
  end if;
end $$;

-- Explicit "End day".
create or replace function app.attendance_end_day()
returns void language plpgsql security definer set search_path = public, app as $$
declare v_tenant uuid; v_day attendance_days;
begin
  select tenant_id into v_tenant from user_profiles where id = auth.uid();
  select * into v_day from attendance_days where tenant_id = v_tenant and user_id = auth.uid() and work_date = current_date;
  if v_day.id is null or v_day.checked_in_at is null then
    raise exception 'no active day to end' using errcode = '55000';
  end if;
  if v_day.checked_out_at is not null then
    raise exception 'the day is already closed' using errcode = '55000';
  end if;
  update attendance_days
    set checked_out_at = now(), check_out_source = 'explicit', last_activity_at = now(),
        worked_minutes = round(extract(epoch from (now() - v_day.checked_in_at)) / 60.0)
    where id = v_day.id;
end $$;

-- Nightly close (service-role): close any still-open day for p_work_date, inferring the checkout
-- from last activity (falling back to check-in), flagged check_out_source='inferred'. Trigger wiring
-- is a deploy-time choice (external cron → Edge Function, or pg_cron) — see the header.
create or replace function app.attendance_nightly_close(p_work_date date)
returns int language plpgsql security definer set search_path = public, app as $$
declare v_count int;
begin
  with closed as (
    update attendance_days ad
      set checked_out_at = case when ad.last_activity_at is not null and ad.last_activity_at >= ad.checked_in_at
                                then ad.last_activity_at else ad.checked_in_at end,
          check_out_source = 'inferred',
          worked_minutes = round(extract(epoch from (
            (case when ad.last_activity_at is not null and ad.last_activity_at >= ad.checked_in_at
                  then ad.last_activity_at else ad.checked_in_at end) - ad.checked_in_at)) / 60.0)
      where ad.work_date = p_work_date and ad.checked_in_at is not null and ad.checked_out_at is null
      returning 1)
  select count(*) into v_count from closed;
  return v_count;
end $$;

revoke execute on function app.attendance_nightly_close(date) from public;
grant execute on function app.attendance_nightly_close(date) to service_role;

-- ---- 4. deviation resolver (pure, SLA-style; nothing stored) ----
-- Resolves the tenant default profile (per-person assignment is a later extension), then flags
-- late / short / missing / no-checkout. Suppressed (all false) on non-workdays, holidays, and
-- approved leave. SECURITY INVOKER, so RLS on attendance_days scopes what a caller can resolve.
create or replace function app.attendance_deviation(p_user uuid, p_date date)
returns table (late boolean, short boolean, missing boolean, no_checkout boolean, suppressed boolean)
language plpgsql stable set search_path = public, app as $$
declare v_tenant uuid; v_prof attendance_profiles; v_day attendance_days; v_suppressed boolean;
begin
  select tenant_id into v_tenant from user_profiles where id = p_user;
  select * into v_prof from attendance_profiles where tenant_id = v_tenant and is_default;

  -- suppression: non-workday, or an overlapping holiday/leave for the person's resource
  v_suppressed :=
    (v_prof.id is not null and not (extract(isodow from p_date)::int = any (v_prof.workdays)))
    or exists (
      select 1 from resource_unavailability ru
      join resources r on r.id = ru.resource_id
      where r.user_id = p_user and ru.kind in ('leave','holiday')
        and ru.timespan && tstzrange(p_date::timestamptz, (p_date + 1)::timestamptz, '[)')
    );

  select * into v_day from attendance_days where user_id = p_user and work_date = p_date;

  if v_suppressed then
    return query select false, false, false, false, true; return;
  end if;

  late := v_day.checked_in_at is not null and v_prof.expected_check_in is not null
    and (v_day.checked_in_at at time zone 'UTC')::time
        > (v_prof.expected_check_in + make_interval(mins => v_prof.grace_minutes));
  short := v_day.checked_out_at is not null and v_prof.expected_minutes is not null
    and v_day.worked_minutes < v_prof.expected_minutes;
  missing := (v_day.id is null or v_day.checked_in_at is null);
  no_checkout := v_day.check_out_source = 'inferred';
  suppressed := false;
  return query select
    coalesce(late,false), coalesce(short,false), coalesce(missing,false),
    coalesce(no_checkout,false), false;
end $$;
comment on function app.attendance_deviation(uuid, date) is
  'ADR-0031: computed attendance deviations (late/short/missing/no-checkout) for a person-day, suppressed on non-workdays, holidays and approved leave. Read-scoped via RLS on attendance_days.';
