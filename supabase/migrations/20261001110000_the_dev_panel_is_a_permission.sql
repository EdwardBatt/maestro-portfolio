-- ADR-0120 addendum (Edward, 1 Oct): the Dev panel — preview a role, view as a person read-only — is a permission,
-- `dev_view:view`, granted on the Roles screen. Edward: "this permission will only be added to C-Level… and should C-level require
-- maybe extend to Department Leads for their departments."
--
--   1) `permission_catalog` gains `dev_view:view`. The Power Admin holds it like every grant (grant_new_catalog_to_power_admin);
--      the CEO, COO and CFO roles are granted it here, existing tenants and new ones (`seed_tenant_roles` re-emitted whole from
--      20260929150000; the only edit is the three `dev_view:view` lines).
--   2) WHO may be viewed follows the holder's own role reach (`app.view_as_reaches`): an organisation-wide role (tenant,
--      all_accounts) anyone active in the tenant; a department-scoped role the people of their department; a team-scoped
--      role their team; any other scope nobody. Never oneself.
--   3) `app.view_as_target` — shared by the pre-request hook and `view_as_start` — asks the permission and the reach instead
--      of "is a Power Admin". Read-only, the claims swap and the audit row are unchanged (ADR-0120 d.1-d.2).
--   4) `public.view_as_options()` answers the panel for the REAL person (the hook stamps `view_as_by` while viewing): whether
--      they hold the permission, and the people they may view.
--
-- `security definer` (ADR-0120 d.1 already covers the target check): every function here reads another person's profile and
-- grants, which RLS would not show the caller; each answers only about the real caller.

begin;

insert into permission_catalog (resource, action, description)
values ('dev_view', 'view', 'Use the Dev panel: preview a role, and view Maestro as a person within your reach, read-only.')
on conflict do nothing;

insert into role_grants (tenant_id, role_id, resource, action)
select r.tenant_id, r.id, 'dev_view', 'view'
  from roles r
 where r.key in ('ceo', 'coo', 'cfo')
on conflict do nothing;

-- ============================================================================
-- 1) new tenants: seed_tenant_roles (from 20260929150000, via its source; only the view_as lines added)
-- ============================================================================
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
    ('chat_oversight','view'),
    ('dev_view','view')   -- ADR-0120 addendum (1 Oct)
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_coo, r, a from (values
    ('admin.users','view'),('admin.resources','view'),('admin.organization','view'),
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('team','view'),('audit','view'),('bookings','approve'),('health','view'),('media','manage'),
    ('chat_oversight','view'),
    ('dev_view','view')   -- ADR-0120 addendum (1 Oct)
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_cfo, r, a from (values
    ('admin.organization','view'),('admin.resources','view'),
    ('schedule','view'),('month_overview','view'),('bookings_table','view'),
    ('rates','view'),('bookings','export'),('health','view'),('media','manage'),
    ('chat_oversight','view'),
    ('dev_view','view')   -- ADR-0120 addendum (1 Oct)
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

-- ============================================================================
-- 2) the reach
-- ============================================================================
create or replace function app.view_as_reaches(p_real uuid, p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, app, extensions
as $$
  select coalesce((
    select case r.scope
             when 'tenant'       then true
             when 'all_accounts' then true
             when 'department'   then real_p.department_id is not null and target.department_id = real_p.department_id
             when 'team'         then real_p.team_id is not null and target.team_id = real_p.team_id
             else false
           end
      from user_profiles real_p
      join roles r on r.id = real_p.role_id
      join user_profiles target on target.id = p_user
     where real_p.id = p_real
       and target.tenant_id = real_p.tenant_id
       and target.id <> real_p.id
  ), false);
$$;

comment on function app.view_as_reaches(uuid, uuid) is
  'ADR-0120 addendum d.2: may p_real view as p_user? By p_real''s role scope — tenant / all_accounts anyone in the tenant, '
  'department their department, team their team, otherwise nobody; never oneself.';

revoke all on function app.view_as_reaches(uuid, uuid) from public;

-- ============================================================================
-- 3) the checks both entry points share
-- ============================================================================
create or replace function app.view_as_target(p_real uuid, p_user uuid)
returns auth.users
language plpgsql stable security definer
set search_path = public, app, extensions
as $$
declare
  v_real   user_profiles;
  v_target user_profiles;
  v_user   auth.users;
begin
  select * into v_real from user_profiles where id = p_real;
  if v_real.id is null or not v_real.is_active
     or not app.user_has_permission(p_real, 'dev_view', 'view') then
    raise exception 'you may not view Maestro as another person' using errcode = '42501';
  end if;
  select * into v_target from user_profiles where id = p_user;
  if v_target.id is null or not v_target.is_active or not app.view_as_reaches(p_real, p_user) then
    raise exception 'that person cannot be viewed' using errcode = '42501';
  end if;
  select * into v_user from auth.users where id = p_user;
  if v_user.id is null then
    raise exception 'that person cannot be viewed' using errcode = '42501';
  end if;
  return v_user;
end $$;

revoke all on function app.view_as_target(uuid, uuid) from public;

-- ============================================================================
-- 4) what the panel offers the real person
-- ============================================================================
create or replace function public.view_as_options()
returns jsonb
language plpgsql stable security definer
set search_path = public, app, extensions
as $$
declare
  v_real uuid := coalesce(app.try_uuid(auth.jwt() ->> 'view_as_by'), auth.uid());
begin
  if v_real is null
     or not exists (select 1 from user_profiles where id = v_real and is_active)
     or not app.user_has_permission(v_real, 'dev_view', 'view') then
    return jsonb_build_object('allowed', false, 'people', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'allowed', true,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'role', r.name) order by p.display_name)
        from user_profiles p
        left join roles r on r.id = p.role_id
       where p.is_active
         and app.view_as_reaches(v_real, p.id)
    ), '[]'::jsonb));
end $$;

comment on function public.view_as_options() is
  'ADR-0120 addendum d.4: for the REAL signed-in person (view_as_by while viewing), whether they may use the Dev panel and '
  'the active people they may view as.';

revoke all on function public.view_as_options() from public;
grant execute on function public.view_as_options() to authenticated;

comment on function public.view_as_start(uuid) is
  'ADR-0120 (+ addendum 1 Oct): a dev_view:view holder starts viewing as a person in their reach. Checks the same rules as the '
  'pre-request hook, records the view in audit_events, and returns the person''s identity (id, email, name, app_metadata).';

commit;
