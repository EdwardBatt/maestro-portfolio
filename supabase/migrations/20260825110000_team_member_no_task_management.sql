-- Team Member holds no task management, and the grant an earlier seeder dropped is restored.
--
-- PART 1 — TEAM MEMBER LOSES project_tasks:manage (Edward, 25 Aug).
-- It has been in the seed list since the very first RBAC migration (20260802100000), where the
-- entire rationale reads "-- Team Member." Nobody decided it, and nothing a Team Member does needs
-- it: app.sub_task_start and app.sub_task_submit both gate on `assignee_id = auth.uid()`;
-- sub_tasks_manage_update carries an explicit `or assignee_id = auth.uid()` branch whose own comment
-- says "Team Member has no manage path here, but may progress a sub_task assigned to them"; uploads
-- are media:manage; their queue is my_tasks:view.
--
-- What it actually bought them was the /deliverables and /pipeline nav entries and the Deliverables
-- screen's management controls — every write behind which RLS then refused, because creating or
-- editing a task also needs the task's department/team in reach and a Team Member is scoped to
-- 'self'. A menu item and a set of buttons that cannot work: the same "fill the form, then get
-- refused" shape as the schedule's + button.
--
-- PART 2 — RESTORING account_manager:manage, WHICH I LOST.
-- 20260823140000 added ('account_manager','manage') to the Account Manager role, making its holders
-- eligible to be named as a client's AM. 20260824170000 then reproduced the whole 130-line seeder
-- from the OLDER 20260823110000 base and silently dropped it — a diff of the two confirms it is the
-- only unintended loss. The existing tenant is unaffected (20260823140000 wrote its live row
-- directly), but every tenant seeded since would get an Account Manager who cannot be assigned to a
-- client: users_holding_permission('account_manager','manage') returns nobody and the client
-- registration picker comes up empty.
--
-- The live-rows half is re-run defensively with on-conflict-do-nothing, so this is correct whether
-- or not the row is already there.
--
-- ADR-0033 search_path pin added while here: the live seeder lacked it, because CREATE OR REPLACE
-- without a SET resets proconfig and drops the pin the 20260819250000 sweep applied.

begin;

-- ============================================================================
-- 1) the seeder — new tenants
-- ============================================================================
-- Reproduced from 20260824170000 with exactly two grant changes (team_member loses
-- project_tasks:manage, account_manager regains account_manager:manage) and the search_path pin.
-- Verified by diffing the two bodies rather than retyping — reproducing this seeder from the wrong
-- base is precisely what caused Part 2.

create or replace function app.seed_tenant_roles(p_tenant uuid) returns void
language plpgsql
set search_path = public, app, extensions as $$
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

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_am, r, a from (values
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),
    ('bookings_table','view'),('team','view'),('exceptions','view'),
    -- 24 Aug: an account manager assigns work, so it must be able to schedule it (ADR-0040) —
    -- and to cancel what it scheduled, rather than needing somebody else to take it off.
    ('bookings','create'),('bookings','update'),('bookings','delete'),
    ('projects','manage'),('project_tasks','manage'),
    ('clients','view'),('clients','manage'),('account_manager','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, resource, action from role_grants where role_id = v_sched on conflict do nothing;
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, r, a from (values
    ('bookings','approve'),('audit','view'),('reviews','moderate'),('team','view'),('exceptions','view'),
    ('kpi','manage')
  ) as g(r,a) on conflict do nothing;

  -- Team Leader: now holds reviews:moderate so they can be a reviewer / sign off deliverables.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_teamlead, r, a from (values
    ('team','view'),('schedule','view'),('my_calendar','view'),('my_tasks','view'),
    ('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('bookings','create'),('bookings','update'),('bookings','delete'),('bookings','approve'),
    ('project_tasks','manage'),('exceptions','view'),('reviews','moderate'),
    ('kpi','manage')
  ) as g(r,a) on conflict do nothing;

  -- Deputy clones the Team Leader's grants (incl. the new reviews:moderate).
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_deputy, resource, action from role_grants where role_id = v_teamlead on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_member, r, a from (values
    ('schedule','view'),
    ('my_calendar','view'),('my_tasks','view'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_ceo, r, a from (values
    ('admin.users','view'),('admin.resources','view'),('admin.organization','view'),('admin.roles','view'),
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('team','view'),('audit','view'),('rates','view'),('health','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_coo, r, a from (values
    ('admin.users','view'),('admin.resources','view'),('admin.organization','view'),
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('team','view'),('audit','view'),('bookings','approve'),('health','view')
  ) as g(r,a) on conflict do nothing;

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

-- ============================================================================
-- 2) the live rows — the existing tenant, today
-- ============================================================================
-- A seeder edit alone changes nothing for a tenant that already exists. Fenced with app.system_op
-- because these are grant rows written by a migration rather than by a person on the Roles screen.
select set_config('app.system_op', 'on', true);

-- Team Member: remove the grant. A per-user overlay allow (user_grants, ADR-0036) is a separate
-- table and is deliberately NOT touched — if somebody has been given task management individually,
-- that stays.
delete from role_grants g
using roles r
where g.role_id = r.id
  and r.key = 'team_member'
  and g.resource = 'project_tasks'
  and g.action = 'manage';

-- Account Manager: restore the lost eligibility grant.
insert into role_grants (tenant_id, role_id, resource, action)
select r.tenant_id, r.id, 'account_manager', 'manage'
from roles r
where r.key = 'account_manager'
on conflict do nothing;

select set_config('app.system_op', 'off', true);

commit;
