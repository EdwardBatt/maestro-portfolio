-- ADR-0029 (I7.3): reusable SLA profiles per work type + attach points + resolver.
--
-- The `sla_profiles`/`accountability_profiles` tables already exist (M1.4, referenced by
-- work_types); this increment gives sla_profiles the configurable turnaround it was stubbed for,
-- two attach points (project-level on jobs, leaf-level on sub_tasks), a pure resolver that walks
-- the precedence chain, and a dedicated `sla_profiles:manage` grant (leads + Power Admin).
--
-- Scope for this slice (ADR-0029 Part 3 / ADR-0024): profiles carry a turnaround + a small
-- declarative deadline_rule. The pausable/attributable clock, attribution and rewards stay P2.
-- We are adding CONFIGURABLE TARGETS, not the accountability engine.

-- ---- 1. extend sla_profiles with the turnaround machinery (table already exists) ----
alter table sla_profiles add column work_type_id     uuid references work_types(id);
alter table sla_profiles add column turnaround_hours numeric(6,2)
  check (turnaround_hours is null or turnaround_hours > 0);
alter table sla_profiles add column deadline_rule    jsonb   not null default '{}'::jsonb;
alter table sla_profiles add column is_default       boolean not null default false;
alter table sla_profiles add column created_by       uuid references user_profiles(id);

create index idx_sla_profiles_work_type_id on sla_profiles (work_type_id);
-- at most one default profile per work type (nullable work_type_id => tenant-level defaults are
-- not uniquely constrained by design; the resolver picks the earliest deterministically).
create unique index uq_sla_profile_wt_default
  on sla_profiles (tenant_id, work_type_id) where is_default;

comment on column sla_profiles.work_type_id is
  'ADR-0029: the discipline this profile targets (null = generic/tenant-level).';
comment on column sla_profiles.turnaround_hours is
  'ADR-0029: committed turnaround for the effective-SLA resolver. Null = the profile sets no turnaround (resolver falls through).';
comment on column sla_profiles.is_default is
  'ADR-0029: the default profile for its work type (or, when work_type_id is null, a tenant-level default).';

-- ---- 2. attach points: project-level (jobs) and leaf-level (sub_tasks) ----
alter table jobs      add column sla_profile_id uuid references sla_profiles(id);
alter table sub_tasks add column sla_profile_id uuid references sla_profiles(id);
create index idx_jobs_sla_profile_id      on jobs (sla_profile_id);
create index idx_sub_tasks_sla_profile_id on sub_tasks (sla_profile_id);
comment on column sub_tasks.sla_profile_id is
  'ADR-0029: leaf profile attach point. sub_tasks.sla_hours stays the manual override that beats every profile.';

-- ---- 3. effective-SLA resolver (pure, read-only) ----
-- Walks the precedence chain for a sub-task and returns the applicable turnaround in hours:
--   1. sub_tasks.sla_hours        — manual leaf override (beats everything)
--   2. sub_tasks.sla_profile_id   — leaf profile
--   3. job.sla_profile_id         — project profile (the deliverable's job, if any)
--   4. work_types.sla_profile_id  — the work type's explicitly-assigned profile
--   5. is_default profile for that work type
--   6. is_default profile with work_type_id null — the tenant default
-- A tier whose profile carries a NULL turnaround falls through to the next. Returns null if
-- nothing in the chain sets a turnaround. Tenant-scoped so it is safe inside definer contexts.
create or replace function app.effective_sla(p_sub_task uuid)
returns numeric language plpgsql stable set search_path = public, app as $$
declare
  v_tenant      uuid;
  v_sla_hours   numeric;
  v_st_profile  uuid;
  v_job_profile uuid;
  v_wt          uuid;
  v_wt_profile  uuid;
  v_result      numeric;
begin
  select s.tenant_id, s.sla_hours, s.sla_profile_id, j.sla_profile_id,
         coalesce(j.work_type_id, str.work_type_id)
    into v_tenant, v_sla_hours, v_st_profile, v_job_profile, v_wt
  from sub_tasks s
  join deliverables d on d.id = s.deliverable_id
  left join jobs    j   on j.id   = d.job_id
  left join streams str on str.id = d.stream_id
  where s.id = p_sub_task;
  if not found then return null; end if;

  -- 1. manual leaf override
  if v_sla_hours is not null then return v_sla_hours; end if;

  -- 2. leaf profile
  select turnaround_hours into v_result from sla_profiles where id = v_st_profile;
  if v_result is not null then return v_result; end if;

  -- 3. project (job) profile
  select turnaround_hours into v_result from sla_profiles where id = v_job_profile;
  if v_result is not null then return v_result; end if;

  -- 4. work type's explicitly-assigned profile
  select wt.sla_profile_id into v_wt_profile from work_types wt where wt.id = v_wt;
  select turnaround_hours into v_result from sla_profiles where id = v_wt_profile;
  if v_result is not null then return v_result; end if;

  -- 5. work type's default profile
  select turnaround_hours into v_result from sla_profiles
    where work_type_id = v_wt and is_default;
  if v_result is not null then return v_result; end if;

  -- 6. tenant default (work_type_id null, is_default) — earliest wins deterministically
  select turnaround_hours into v_result from sla_profiles
    where tenant_id = v_tenant and work_type_id is null and is_default
    order by created_at, id limit 1;
  return v_result;
end $$;

comment on function app.effective_sla(uuid) is
  'ADR-0029: resolve a sub-task''s effective SLA turnaround (hours) — leaf sla_hours override, then leaf/project/work-type-explicit/work-type-default/tenant-default profiles. Null if unset.';

-- ---- 4. authority: a dedicated sla_profiles:manage grant (leads + Power Admin) ----
insert into permission_catalog (resource, action, description) values
  ('sla_profiles', 'manage', 'Create and edit reusable SLA profiles (ADR-0029)')
on conflict (resource, action) do nothing;

-- move the write policy off organization:manage onto the dedicated grant; reads stay tenant-wide.
drop policy sla_profiles_admin_write on sla_profiles;
create policy sla_profiles_manage_write on sla_profiles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('sla_profiles', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('sla_profiles', 'manage'));

-- reproduce the authoritative seeder (20260819100000) with sla_profiles:manage folded into the
-- two lead roles (Power Admin gets it via the catalog copy; Deputy inherits from Team Leader).
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
    ('sla_profiles','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_teamlead, r, a from (values
    ('team','view'),('schedule','view'),('my_calendar','view'),('my_tasks','view'),
    ('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('bookings','create'),('bookings','update'),('bookings','approve'),
    ('project_tasks','manage'),('exceptions','view'),
    ('sla_profiles','manage')
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

-- re-seed every existing tenant (idempotent — adds sla_profiles:manage to the lead roles only).
select app.seed_tenant_roles(id) from tenants;
