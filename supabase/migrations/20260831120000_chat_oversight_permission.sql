-- I31.2 (ADR-0062 d.4) — the permission that puts the management layer in every work conversation.
--
-- Edward, 31 Aug: "All C SUITE users, Traffic Manager, Power Admin, Department Leads and Team
-- Leaders for all assignees, all assignees and reviewers should have access to each chat." This
-- migration carries the first clause. Leads reach conversations through SCOPE, not through a grant,
-- so they need no row here — see `20260831120100`, which is where that half lives.
--
-- NAMING DEVIATION FROM THE ADR, recorded deliberately. ADR-0062 d.4 specifies `chat:oversight`.
-- It cannot be inserted: `permission_catalog.action` carries a CHECK admitting only
-- view/create/update/delete/approve/export/manage/moderate (`20260802100000:25`). Rather than widen
-- that vocabulary system-wide for one permission, this follows the precedent ADR-0055 set with
-- `deliverable_owner:manage` (`20260828110000`) and ADR-0023 with `account_manager:manage` — a
-- NARROW RESOURCE with a generic verb. `chat_oversight:view` reads as precisely as the ADR's name
-- and changes no constraint every other permission depends on.
--
-- WHAT IT GRANTS, stated plainly because it is a privacy decision and not a technical one: the
-- holder is a FULL PARTICIPANT — read, post, and add people — in every conversation ATTACHED TO
-- WORK in their tenant, including a two-person thread about somebody's own task. It confers nothing
-- on a `dm` or `group` conversation; ADR-0062 d.4 fences it to work anchors precisely so that
-- private messaging, if it is ever built, is a decision taken then rather than one made here by
-- accident. ADR-0063 d.8 requires every conversation to show its members and why each is there, so
-- the reach is visible to the people it applies to rather than silent.
--
-- SEEDING. ADR-0062 d.4 names power_admin, scheduler (Traffic Manager) and the four C-suite roles.
--   * `power_admin` needs no line: the after-insert trigger on `permission_catalog` grants it every
--     catalog row, in existing tenants too.
--   * `department_lead` INHERITS the scheduler set wholesale, exactly as it inherits every other
--     scheduler permission (noted in `20260828110000`). A department lead therefore holds
--     tenant-wide chat oversight through inheritance, ON TOP of the department scope that ADR-0062
--     d.3 gives them. That is wider than d.3 alone and it is flagged, not smuggled: breaking the
--     inheritance for one row would be a bigger change than the row. Revoke it on the Roles screen
--     if that is not wanted.
--   * **`cco` is not seeded by `seed_tenant_roles` at all** — this tenant's CCO role was created by
--     hand on the Roles screen, so no NEW tenant gets one. Backfilled below by key where it exists;
--     making CCO a seeded role is a separate question and not this migration's business.
--
-- The function below is `20260828110000` extracted VERBATIM by script — not retyped — with four
-- value-list entries added. Reproducing whole is what keeps the body and its `search_path` intact
-- (traps.md: "reproducing a function from the wrong base silently drops whatever came after").

begin;

insert into permission_catalog (resource, action, description) values
  ('chat_oversight', 'view',
   'Full participation — read, post and add people — in every conversation attached to WORK '
   '(ADR-0062 d.4). Never applies to a dm/group conversation. Held by management: Power Admin, '
   'Traffic Manager and the C-suite.')
on conflict do nothing;

-- ---------------------------------------------------------------- future tenants ----
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
    ('clients','view'),('deliverable_owner','manage'),('chat_oversight','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_am, r, a from (values
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),
    ('bookings_table','view'),('team','view'),('exceptions','view'),
    -- 24 Aug: an account manager assigns work, so it must be able to schedule it (ADR-0040) —
    -- and to cancel what it scheduled, rather than needing somebody else to take it off.
    ('bookings','create'),('bookings','update'),('bookings','delete'),
    ('projects','manage'),('project_tasks','manage'),
    ('clients','view'),('clients','manage'),('account_manager','manage'),('media','manage'),
    ('deliverable_owner','manage')
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
    ('team','view'),('audit','view'),('rates','view'),('health','view'),('media','manage'),
    ('chat_oversight','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_coo, r, a from (values
    ('admin.users','view'),('admin.resources','view'),('admin.organization','view'),
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('team','view'),('audit','view'),('bookings','approve'),('health','view'),('media','manage'),
    ('chat_oversight','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_cfo, r, a from (values
    ('admin.organization','view'),('admin.resources','view'),
    ('schedule','view'),('month_overview','view'),('bookings_table','view'),
    ('rates','view'),('bookings','export'),('health','view'),('media','manage'),
    ('chat_oversight','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_portal, 'portal', 'view') on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, id, 'directory', 'view'
  from roles where tenant_id = p_tenant and key <> 'client_portal'
  on conflict do nothing;

  perform set_config('app.system_op', 'off', true);
end $$;

-- ---------------------------------------------------------------- existing tenants ----
-- By role KEY, so a tenant that renamed "CEO" still gets it and a tenant with no CCO is simply
-- skipped. power_admin is deliberately absent: the catalog trigger has already granted it.
insert into role_grants (tenant_id, role_id, resource, action)
select r.tenant_id, r.id, 'chat_oversight', 'view'
from roles r
where r.key in ('ceo', 'coo', 'cfo', 'cco', 'scheduler', 'department_lead')
on conflict do nothing;

commit;
