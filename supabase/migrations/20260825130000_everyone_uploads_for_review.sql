-- Everyone internal can upload a version for review (Edward, 25 Aug).
--
-- REPORTED FROM LIVE USE: a user could see the review panel but had no upload button. The panel
-- renders the control only for holders of media:manage (`ReviewPanel.tsx:35`), and the seed list
-- gave it to Power Admin, Traffic Manager, Department Lead (which clones Traffic Manager) and Team
-- Member — but NOT to Team Leader, Deputy Team Leader (which clones Team Leader), Account Manager,
-- or the C-suite. So a Team Leader could moderate a review but never put a file into one.
--
-- Like Team Member's project_tasks:manage, this was an omission in the original list rather than a
-- decision: Team Leader was given reviews:moderate so it can review, and never media:manage so it
-- can produce. Edward's call: everyone internal uploads.
--
-- The Client Portal role is deliberately excluded. It holds portal:view and nothing else, and an
-- external client putting files onto the internal version chain is a different feature (M10) with
-- its own decisions.
--
-- search_path pin carried over from 20260825110000 per ADR-0033.

begin;

-- ============================================================================
-- 1) the seeder — new tenants
-- ============================================================================
-- Reproduced from 20260825110000 with SIX single-line additions and nothing else: ('media','manage')
-- appended to account_manager, department_lead, team_lead, ceo, coo and cfo. Verified by diffing the
-- two bodies, not by retyping — this seeder has already lost a grant once that way (see
-- 20260825110000 Part 2). deputy_team_lead and department_lead also inherit by cloning.

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
    ('clients','view'),('clients','manage'),('account_manager','manage'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, resource, action from role_grants where role_id = v_sched on conflict do nothing;
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, r, a from (values
    ('bookings','approve'),('audit','view'),('reviews','moderate'),('team','view'),('exceptions','view'),
    ('kpi','manage'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  -- Team Leader: now holds reviews:moderate so they can be a reviewer / sign off deliverables.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_teamlead, r, a from (values
    ('team','view'),('schedule','view'),('my_calendar','view'),('my_tasks','view'),
    ('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('bookings','create'),('bookings','update'),('bookings','delete'),('bookings','approve'),
    ('project_tasks','manage'),('exceptions','view'),('reviews','moderate'),
    ('kpi','manage'),('media','manage')
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
    ('team','view'),('audit','view'),('rates','view'),('health','view'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_coo, r, a from (values
    ('admin.users','view'),('admin.resources','view'),('admin.organization','view'),
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('team','view'),('audit','view'),('bookings','approve'),('health','view'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_cfo, r, a from (values
    ('admin.organization','view'),('admin.resources','view'),
    ('schedule','view'),('month_overview','view'),('bookings_table','view'),
    ('rates','view'),('bookings','export'),('health','view'),('media','manage')
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
select set_config('app.system_op', 'on', true);

-- Every role except the external portal. on-conflict-do-nothing, so the four that already hold it
-- are untouched and this is safe to re-run.
insert into role_grants (tenant_id, role_id, resource, action)
select r.tenant_id, r.id, 'media', 'manage'
from roles r
where r.key <> 'client_portal'
on conflict do nothing;

select set_config('app.system_op', 'off', true);

commit;
