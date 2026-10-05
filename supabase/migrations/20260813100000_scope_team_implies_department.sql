-- ADR-0014 (decision 1): a department-scoped role reaches resources by their
-- team's parent department, not only the resource's own department_id. So you
-- tag a resource's Team and department coverage is inferred — no need to set
-- both department_id AND team_id on every resource.
--
-- Only the `department` branch changes; tenant/team/account/self are identical
-- to 20260812120100. `create or replace` updates behaviour in place — every
-- policy that calls app.in_write_scope (bookings, blackouts, sub_tasks, series,
-- projects) picks it up with no policy rewrite. The teams lookup runs under the
-- caller's RLS (teams_tenant_select) and hits teams by PK; teams.department_id
-- is indexed.

create or replace function app.in_write_scope(p_department uuid, p_team uuid, p_account_manager uuid)
returns boolean language sql stable as $$
  select case app.current_scope()
    when 'tenant'     then true
    when 'department' then
      (p_department is not null and p_department = app.current_department_id())
      or (p_team is not null and exists (
            select 1 from public.teams t
            where t.id = p_team and t.department_id = app.current_department_id()))
    when 'team'       then p_team is not null and p_team = app.current_team_id()
    when 'account'    then p_account_manager is not null and p_account_manager = auth.uid()
    else false                       -- 'self' handled by explicit owner predicates
  end
$$;
