-- Role grant corrections (Edward, 24 Aug) — the three questions L6.9 surfaced, answered.
--
-- L6.9 checked what the L6.5 sweep left behind and found nothing lost: every role matched the
-- authoritative seed. But matching the seed is not the same as being right, and three gaps showed up:
--
--   * account_manager  — "owns assigned campaigns; assigns/coordinates within their accounts", yet
--                        held no booking permission at all. Every ad-hoc assignment it made
--                        half-succeeded: the task committed, the scheduling was refused. ADR-0040
--                        turns that silent half-success into an outright refusal, so without this
--                        grant an account manager could no longer assign work at all. The two ship
--                        together deliberately.
--   * team_member      — could not open the schedule. Not a security stance, just an omission: they
--                        could see their own work but never where it sat in the week.
--   * team_lead        — could create and move bookings but not cancel them, so a lead could put
--                        work on someone's calendar and then need somebody else to take it off.
--
-- Two halves, as always with grants: the SEEDER (so new tenants are born correct) and the LIVE ROWS
-- (so the existing tenant changes today). Missing the second is how a seeder edit silently does
-- nothing — noted in 20260823110000's own comments.
--
-- account_manager also gains bookings:delete (Edward, 24 Aug): having scheduled the work it
-- assigned, it should be able to cancel it rather than needing a Traffic Manager to take it off.

begin;

-- ============================================================================
-- 1) the seeder — new tenants
-- ============================================================================
-- Amending only the three grant lists; every other line of app.seed_tenant_roles is untouched.
-- Reproduced from 20260823110000 rather than retyped.

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

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_am, r, a from (values
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),
    ('bookings_table','view'),('team','view'),('exceptions','view'),
    -- 24 Aug: an account manager assigns work, so it must be able to schedule it (ADR-0040) —
    -- and to cancel what it scheduled, rather than needing somebody else to take it off.
    ('bookings','create'),('bookings','update'),('bookings','delete'),
    ('projects','manage'),('project_tasks','manage'),
    ('clients','view'),('clients','manage')
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
    ('my_calendar','view'),('my_tasks','view'),('project_tasks','manage'),('media','manage')
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

insert into role_grants (tenant_id, role_id, resource, action)
select r.tenant_id, r.id, g.resource, g.action
from roles r
cross join (values
  ('account_manager','bookings','create'),
  ('account_manager','bookings','update'),
  ('account_manager','bookings','delete'),
  ('team_lead','bookings','delete'),
  ('deputy_team_lead','bookings','delete'),
  ('team_member','schedule','view')
) as g(role_key, resource, action)
where r.key = g.role_key
on conflict do nothing;

select set_config('app.system_op', 'off', true);

commit;
