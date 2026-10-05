-- ADR-0029 (I7.4): customisable KPIs — measured on the individual, rolled up team → department.
--
-- Two tables: kpi_definitions (the tenant catalogue — name, unit, aggregation, bounded formula, the
-- manual/derived seam) and kpi_targets (the measured record, one row per individual/KPI/period).
-- Team and department figures are NOT stored — app.kpi_rollup computes them from the individual rows
-- so there is one source of truth. This slice is manual measurement + visibility only; derived
-- actuals (metric_key computations) and any pay/ranking linkage stay P2 (ADR-0024 / I7.5).
--
-- kpi_targets is the app's FIRST read-restricted table: individual numbers are personnel-sensitive,
-- so reads are scoped to the subject, their lead chain (team → department), and health:view / power
-- admin — peers never see each other's KPIs. Everything else stays tenant-wide-read as before.

-- ---- 1. definitions: the tenant KPI catalogue ----
create table kpi_definitions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  name             text not null,
  unit             text,
  source           text not null default 'manual' check (source in ('manual','derived')),
  metric_key       text,                                  -- derived only: on_time_pct | throughput | avg_rounds | …
  work_type_id     uuid references work_types(id),
  higher_is_better boolean not null default true,
  aggregation      text not null default 'avg' check (aggregation in ('avg','sum','weighted')),
  formula          jsonb not null default '{}'::jsonb,    -- bounded weighted combination over the signal catalogue
  created_by       uuid references user_profiles(id),
  created_at       timestamptz not null default now(),
  constraint uq_kpi_definitions_tenant_name unique (tenant_id, name)
);
create index idx_kpi_definitions_tenant_id on kpi_definitions (tenant_id);

alter table kpi_definitions enable row level security;
alter table kpi_definitions force row level security;
-- definitions are the catalogue (not personnel data): tenant-wide read, kpi:manage to write.
create policy kpi_definitions_tenant_select on kpi_definitions
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy kpi_definitions_manage_write on kpi_definitions
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('kpi', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('kpi', 'manage'));
create trigger audit_row_change
  after insert or update or delete on kpi_definitions
  for each row execute function app.audit_row_change();

-- ---- 2. targets: the measured record, on the INDIVIDUAL ----
create table kpi_targets (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  kpi_definition_id uuid not null references kpi_definitions(id) on delete cascade,
  user_id           uuid not null references user_profiles(id) on delete cascade,
  period_start      date not null,
  period_end        date not null,
  target            numeric,
  actual            numeric,
  actual_source     text not null default 'manual' check (actual_source in ('manual','derived')),
  updated_by        uuid references user_profiles(id),
  updated_at        timestamptz not null default now(),
  constraint chk_kpi_targets_period check (period_start <= period_end),
  constraint uq_kpi_targets_person_period unique (kpi_definition_id, user_id, period_start, period_end)
);
create index idx_kpi_targets_tenant_id on kpi_targets (tenant_id);
create index idx_kpi_targets_user_id on kpi_targets (user_id);
create index idx_kpi_targets_definition_id on kpi_targets (kpi_definition_id);

alter table kpi_targets enable row level security;
alter table kpi_targets force row level security;

-- Read/manage scope helpers (SECURITY DEFINER so the subject's team/department lookup is reliable
-- regardless of the caller's RLS, and so the JWT-derived scope helpers compose cleanly).
create or replace function app.caller_can_read_kpi(p_subject uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select
    p_subject = auth.uid()
    or app.has_permission('health', 'view')
    or (
      app.has_permission('kpi', 'manage')
      and app.in_write_scope(
        (select department_id from user_profiles where id = p_subject),
        (select team_id       from user_profiles where id = p_subject),
        null)
    )
$$;
comment on function app.caller_can_read_kpi(uuid) is
  'ADR-0029: may the caller read this subject''s KPI? self, health:view/power admin, or a kpi:manage lead whose write scope (team→department) covers the subject. Peers: no.';

create or replace function app.caller_can_manage_kpi_target(p_subject uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select app.has_permission('kpi', 'manage')
    and app.in_write_scope(
      (select department_id from user_profiles where id = p_subject),
      (select team_id       from user_profiles where id = p_subject),
      null)
$$;
comment on function app.caller_can_manage_kpi_target(uuid) is
  'ADR-0029: may the caller set targets/actuals for this subject? kpi:manage AND the subject falls in the caller''s write scope (a team lead their team, a department lead their department, power admin all).';

create policy kpi_targets_scoped_select on kpi_targets
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.caller_can_read_kpi(user_id));
create policy kpi_targets_manage_write on kpi_targets
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.caller_can_manage_kpi_target(user_id))
  with check (tenant_id = app.current_tenant_id() and app.caller_can_manage_kpi_target(user_id));
create trigger set_updated_at before update on kpi_targets
  for each row execute function app.set_updated_at();
create trigger audit_row_change
  after insert or update or delete on kpi_targets
  for each row execute function app.audit_row_change();

-- ---- 3. rollup resolver: individual → team → department (computed, never stored) ----
-- team   = aggregate of its members' individual rows (members via user_profiles.team_id)
-- dept   = aggregate over its TEAMS (teams.department_id) — so a department avg is the mean of its
--          team means, not re-averaged individuals, matching the hierarchy. SECURITY INVOKER, so the
--          caller only ever aggregates rows their read scope already permits.
create or replace function app.kpi_rollup(p_start date, p_end date)
returns table (kpi_definition_id uuid, scope_kind text, scope_id uuid, target numeric, actual numeric)
language sql stable set search_path = public, app as $$
  with team_roll as (
    select t.kpi_definition_id, up.team_id, d.aggregation,
           case d.aggregation when 'sum' then sum(t.target) else avg(t.target) end as target,
           case d.aggregation when 'sum' then sum(t.actual) else avg(t.actual) end as actual
    from kpi_targets t
    join kpi_definitions d on d.id = t.kpi_definition_id
    join user_profiles up on up.id = t.user_id
    where t.period_start = p_start and t.period_end = p_end and up.team_id is not null
    group by t.kpi_definition_id, up.team_id, d.aggregation
  )
  select kpi_definition_id, 'team'::text, team_id, target, actual from team_roll
  union all
  select tr.kpi_definition_id, 'department'::text, tm.department_id,
         case tr.aggregation when 'sum' then sum(tr.target) else avg(tr.target) end,
         case tr.aggregation when 'sum' then sum(tr.actual) else avg(tr.actual) end
  from team_roll tr
  join teams tm on tm.id = tr.team_id
  where tm.department_id is not null
  group by tr.kpi_definition_id, tm.department_id, tr.aggregation
$$;
comment on function app.kpi_rollup(date, date) is
  'ADR-0029: computed team + department KPI rollups for a period. Individuals→team, then teams→department, per each definition''s aggregation (avg/sum). Read-scoped via RLS on the underlying targets.';

-- ---- 4. authority: scoped kpi:manage grant (leads + Power Admin) ----
insert into permission_catalog (resource, action, description) values
  ('kpi', 'manage', 'Define KPIs and set individual targets/actuals within scope (ADR-0029)')
on conflict (resource, action) do nothing;

-- reproduce the authoritative seeder (20260819180000) with kpi:manage folded into the two lead roles
-- (Power Admin via the catalogue copy; Deputy inherits from Team Leader).
create or replace function app.seed_tenant_roles(p_tenant uuid) returns void
language plpgsql as $$
declare
  v_power uuid; v_sched uuid; v_am uuid; v_lead uuid; v_teamlead uuid; v_member uuid; v_portal uuid;
  v_ceo uuid; v_coo uuid; v_cfo uuid; v_deputy uuid;
begin
  perform set_config('app.system_op', 'on', true);

  insert into roles (tenant_id, key, name, description, is_system, default_route, scope) values
    (p_tenant, 'power_admin',      'Power Admin',         'Full access — holds every grant, automatically including future ones', true,  '/admin',    'tenant'),
    (p_tenant, 'client_portal',    'Client Portal',       'External client access — fixed portal-only grants',                    true,  '/portal',   'self'),
    (p_tenant, 'scheduler',        'Traffic Manager',     'Traffic management — plans and coordinates bookings and projects across the whole organization', false, '/schedule', 'tenant'),
    (p_tenant, 'account_manager',  'Account Manager',     'Owns assigned campaigns; client liaison; assigns/coordinates within their accounts', false, '/schedule', 'account'),
    (p_tenant, 'department_lead',  'Department Lead',     'Sees the org; approves and manages within their department',           false, '/team',     'department'),
    (p_tenant, 'team_lead',        'Team Leader',         'Sees the org; approves and manages within their team',                 false, '/team',     'team'),
    (p_tenant, 'deputy_team_lead', 'Deputy Team Leader',  'Stands in for the Team Leader — same authority, scoped to the team (ADR-0017)', false, '/team', 'team'),
    (p_tenant, 'team_member',      'Team Member',         'Sees own calendar and tasks; works own deliverables',                  false, '/my-work',  'self'),
    (p_tenant, 'ceo',              'CEO',                 'Executive oversight — reads across the whole organization (no administration)', false, '/admin', 'tenant'),
    (p_tenant, 'coo',              'COO',                 'Operations oversight — org-wide read plus booking approval',           false, '/admin',    'tenant'),
    (p_tenant, 'cfo',              'CFO',                 'Finance oversight — cost/rate and organization read, booking export',  false, '/admin',    'tenant')
  on conflict (tenant_id, key) do nothing;

  select id into v_power    from roles where tenant_id = p_tenant and key = 'power_admin';
  select id into v_sched    from roles where tenant_id = p_tenant and key = 'scheduler';
  select id into v_am       from roles where tenant_id = p_tenant and key = 'account_manager';
  select id into v_lead     from roles where tenant_id = p_tenant and key = 'department_lead';
  select id into v_teamlead from roles where tenant_id = p_tenant and key = 'team_lead';
  select id into v_deputy   from roles where tenant_id = p_tenant and key = 'deputy_team_lead';
  select id into v_member   from roles where tenant_id = p_tenant and key = 'team_member';
  select id into v_portal   from roles where tenant_id = p_tenant and key = 'client_portal';
  select id into v_ceo      from roles where tenant_id = p_tenant and key = 'ceo';
  select id into v_coo      from roles where tenant_id = p_tenant and key = 'coo';
  select id into v_cfo      from roles where tenant_id = p_tenant and key = 'cfo';

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_power, resource, action from permission_catalog on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_sched, r, a from (values
    ('schedule','view'),('my_calendar','view'),('my_tasks','view'),
    ('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('bookings','create'),('bookings','update'),('bookings','delete'),('bookings','export'),
    ('blackouts','manage'),('projects','manage'),('project_tasks','manage'),('media','manage'),
    ('clients','view')
  ) as g(r,a) on conflict do nothing;

  -- Account Manager (scope=account): owns campaigns, oversight views + project exception
  -- feed, and (ADR-0021) registers/maintains clients.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_am, r, a from (values
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),
    ('bookings_table','view'),('team','view'),('exceptions','view'),
    ('projects','manage'),('project_tasks','manage'),
    ('clients','view'),('clients','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, resource, action from role_grants where role_id = v_sched on conflict do nothing;
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, r, a from (values
    ('bookings','approve'),('audit','view'),('reviews','moderate'),('team','view'),('exceptions','view'),
    ('sla_profiles','manage'),('kpi','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_teamlead, r, a from (values
    ('team','view'),('schedule','view'),('my_calendar','view'),('my_tasks','view'),
    ('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('bookings','create'),('bookings','update'),('bookings','approve'),
    ('project_tasks','manage'),('exceptions','view'),
    ('sla_profiles','manage'),('kpi','manage')
  ) as g(r,a) on conflict do nothing;

  -- Deputy Team Leader = exact clone of Team Leader (ADR-0017).
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_deputy, resource, action from role_grants where role_id = v_teamlead on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_member, r, a from (values
    ('my_calendar','view'),('my_tasks','view'),('project_tasks','manage'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  -- CEO — full read across the org + health; NO administration, NO *:manage.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_ceo, r, a from (values
    ('admin.users','view'),('admin.resources','view'),('admin.organization','view'),('admin.roles','view'),
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('team','view'),('audit','view'),('rates','view'),('health','view')
  ) as g(r,a) on conflict do nothing;

  -- COO — operations oversight: org-wide read + health + booking approval.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_coo, r, a from (values
    ('admin.users','view'),('admin.resources','view'),('admin.organization','view'),
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('team','view'),('audit','view'),('bookings','approve'),('health','view')
  ) as g(r,a) on conflict do nothing;

  -- CFO — finance posture: cost/rate + organization read, export, health.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_cfo, r, a from (values
    ('admin.organization','view'),('admin.resources','view'),
    ('schedule','view'),('month_overview','view'),('bookings_table','view'),
    ('rates','view'),('bookings','export'),('health','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_portal, 'portal', 'view') on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, id, 'directory', 'view'
  from roles where tenant_id = p_tenant and key <> 'client_portal'
  on conflict do nothing;

  perform set_config('app.system_op', 'off', true);
end $$;

-- re-seed every existing tenant (idempotent — adds kpi:manage to the lead roles only).
select app.seed_tenant_roles(id) from tenants;
