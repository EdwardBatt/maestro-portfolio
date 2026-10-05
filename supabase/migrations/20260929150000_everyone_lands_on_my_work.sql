-- I66.7 (Edward, 29 Sep) — everyone lands on My Work; anyone without My Work lands on the Dashboard.
--
-- Edward chose to keep the per-role landing (`roles.default_route`, the Roles page's "Default landing") and set
-- every role to it, rather than one fixed rule: an administrator can still send a role elsewhere later.
--
--   1) every existing role, every tenant: '/my-work' where the role holds My Work (my_tasks:view or
--      my_calendar:view — the grants the /my-work route asks), else '/dashboard'. The client portal keeps '/portal'.
--   2) `app.seed_tenant_roles` and `app.seed_account_director` reproduced WHOLE from 20260924120000 and
--      20260906110000 (grep confirmed the last definitions) — the only edits are the route literals, so a tenant
--      provisioned tomorrow starts the same way. CEO, COO and CFO hold no My Work, so they land on the Dashboard.
-- The column default is already '/my-work'. The browser also sends anyone whose landing is My Work but who cannot
-- open it to the Dashboard (`app/permissions.tsx`), so a personal grant removed later is never a dead end.

begin;

update roles r
   set default_route = case
         when exists (select 1 from role_grants g
                       where g.role_id = r.id and g.resource in ('my_tasks', 'my_calendar') and g.action = 'view')
         then '/my-work' else '/dashboard' end
 where r.key is distinct from 'client_portal'
   and r.default_route is distinct from '/portal';

create or replace function app.seed_tenant_roles(p_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_power uuid; v_sched uuid; v_am uuid; v_lead uuid; v_teamlead uuid; v_member uuid; v_portal uuid;
  v_ceo uuid; v_coo uuid; v_cfo uuid; v_deputy uuid;
begin
  perform set_config('app.system_op', 'on', true);

  insert into roles (tenant_id, key, name, description, is_system, default_route, scope) values
    (p_tenant, 'power_admin',      'Power Admin',         'Full access — holds every grant, automatically including future ones', true,  '/my-work',  'tenant'),
    (p_tenant, 'client_portal',    'Client Portal',       'External client access — fixed portal-only grants',                    true,  '/portal',   'self'),
    (p_tenant, 'scheduler',        'Traffic Manager',     'Traffic management — plans and coordinates bookings and projects across the whole organization', false, '/my-work',  'tenant'),
    (p_tenant, 'account_manager',  'Account Manager',     'Owns assigned campaigns; client liaison; assigns/coordinates within their accounts', false, '/my-work',  'account'),
    (p_tenant, 'department_lead',  'Department Lead',     'Sees the org; approves and manages within their department',           false, '/my-work',  'department'),
    (p_tenant, 'team_lead',        'Team Leader',         'Sees the org; approves and manages within their team',                 false, '/my-work',  'team'),
    (p_tenant, 'deputy_team_lead', 'Deputy Team Leader',  'Stands in for the Team Leader — same authority, scoped to the team (ADR-0017)', false, '/my-work', 'team'),
    (p_tenant, 'team_member',      'Team Member',         'Sees own calendar and tasks; works own deliverables',                  false, '/my-work',  'self'),
    (p_tenant, 'ceo',              'CEO',                 'Executive oversight — reads across the whole organization (no administration)', false, '/dashboard', 'tenant'),
    (p_tenant, 'coo',              'COO',                 'Operations oversight — org-wide read plus booking approval',           false, '/dashboard', 'tenant'),
    (p_tenant, 'cfo',              'CFO',                 'Finance oversight — cost/rate and organization read, booking export',  false, '/dashboard', 'tenant')
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
    ('deliverable_owner','manage'),
    -- I51.8 (Edward, 16 Sep): the account manager reads My Work too — reviews they are named on,
    -- and whatever the redesign puts there. The role never held it; a notification that landed on
    -- /my-work bounced them to an empty schedule.
    ('my_tasks','view'),
    -- I56.18 (Edward, 24 Sep): the account manager sees the campaign's advertising budget. The
    -- Account Director copies this block, so it holds it too.
    ('campaign_budget','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, resource, action from role_grants where role_id = v_sched on conflict do nothing;
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, r, a from (values
    ('bookings','approve'),('audit','view'),('reviews','moderate'),('team','view'),('exceptions','view'),
    ('kpi','manage'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  -- I48 (13 Sep): the Traffic Manager manages clients and brands too, as the fallback. Added AFTER
  -- the department-lead clone above so it does NOT cascade to the lead — only Traffic gains it.
  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_sched, 'clients', 'manage') on conflict do nothing;
  -- I56.18 (24 Sep): and the budget — also after the clone, so department leads do not inherit it.
  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_sched, 'campaign_budget', 'view') on conflict do nothing;

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

  -- projects:view — every non-portal role can READ the campaigns list and a campaign's detail
  -- (Edward, 12 Sep). Writing a campaign stays projects:manage; this only opens the read surface.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, id, 'projects', 'view'
  from roles where tenant_id = p_tenant and key <> 'client_portal'
  on conflict do nothing;

  perform set_config('app.system_op', 'off', true);
end $function$;

create or replace function app.seed_account_director(p_tenant uuid) returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_dir uuid; v_am uuid;
begin
  insert into roles (tenant_id, key, name, description, is_system, default_route, scope)
  values (
    p_tenant, 'account_director', 'Account Director',
    'Oversees every account — campaigns, clients and briefs across all of them. No administration.',
    false, '/my-work', 'all_accounts'
  )
  on conflict (tenant_id, key) do nothing;

  -- A tenant seeded before ADR-0074 already has the row, so the insert above no-ops and the reach
  -- would stay wrong. Stated separately rather than as a `do update`, which would also overwrite a
  -- name or description an administrator had edited.
  update roles set scope = 'all_accounts'
   where tenant_id = p_tenant and key = 'account_director' and scope <> 'all_accounts';

  select id into v_dir from roles where tenant_id = p_tenant and key = 'account_director';
  select id into v_am  from roles where tenant_id = p_tenant and key = 'account_manager';

  -- Copied, never retyped. If the Account Manager gains a grant tomorrow, re-running this seed
  -- gives it to the Director too; retyping the list is how the two silently diverge.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_dir, rg.resource, rg.action
    from role_grants rg
   where rg.role_id = v_am
  on conflict do nothing;

  -- ADR-0073 d.6. Added explicitly rather than inherited, because the Account Manager holds it for a
  -- different reason (ADR-0070 d.3) and this one holds it as the fallback of last resort.
  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_dir, 'briefs', 'approve')
  on conflict do nothing;
end $$;

commit;
