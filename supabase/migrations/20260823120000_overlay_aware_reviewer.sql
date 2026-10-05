-- L6.7 (ADR-0036): make ad-hoc reviewer naming overlay-aware.
--
-- After the L6.5 revert, public.create_adhoc_deliverable checks the NAMED reviewer against ROLE
-- grants only — so a `reviews:moderate` granted via the per-user overlay (user_grants) did not make
-- someone a *nameable* ad-hoc reviewer (they could still act once named — approve/request-changes
-- go through app.has_permission, which is overlay-aware). This closes that last gap so the overlay
-- works end to end for review moderation too.
--
--   * new helper app.user_holds_permission(user, resource, action) — the arbitrary-user analog of
--     app.has_permission: (role grant OR user allow-grant) AND NOT user deny-grant. Same deny-wins
--     semantics. Not tenant-filtered (a user's grants are inherently in their own tenant), so callers
--     must tenant-check the target separately — which create_adhoc_deliverable now does explicitly.
--   * create_adhoc_deliverable: the reviewer validation splits into (1) reviewer-in-tenant and
--     (2) reviewer-holds-reviews:moderate via user_holds_permission. Everything else (scope gate,
--     no-self-review, get-or-create, inserts) is byte-identical to the reverted 20260823110000 body.

begin;

-- The arbitrary-user permission check (mirrors app.has_permission, but for a named user). STABLE
-- invoker SQL; ADR-0033 search_path pinned. Reads role_grants/user_grants under whatever context the
-- caller supplies (RLS applies for an invoker caller; it is bypassed when invoked from a SECURITY
-- DEFINER function like create_adhoc_deliverable — where the target is tenant-checked before this runs).
create or replace function app.user_holds_permission(p_user uuid, p_resource text, p_action text)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select (
    exists (
      select 1 from public.role_grants rg
      join public.user_profiles up on up.role_id = rg.role_id
      where up.id = p_user and rg.resource = p_resource and rg.action = p_action
    )
    or exists (
      select 1 from public.user_grants ug
      where ug.user_id = p_user and ug.resource = p_resource and ug.action = p_action and ug.effect = 'allow'
    )
  )
  and not exists (
    select 1 from public.user_grants ug
    where ug.user_id = p_user and ug.resource = p_resource and ug.action = p_action and ug.effect = 'deny'
  )
$$;
comment on function app.user_holds_permission(uuid, text, text) is
  'ADR-0036: does a NAMED user hold this permission — (role grant OR user allow) AND NOT user deny? '
  'The arbitrary-user analog of app.has_permission. NOT tenant-filtered; callers tenant-check the user.';

-- create_adhoc_deliverable with an overlay-aware reviewer check (reproduces 20260823110000 B.4,
-- reviewer validation swapped).
create or replace function public.create_adhoc_deliverable(
  p_assignee   uuid,
  p_title      text,
  p_hours      numeric,
  p_starts_at  timestamptz,
  p_due_at     timestamptz,
  p_reviewer   uuid default null
) returns table(sub_task_id uuid, deliverable_id uuid)
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_dept uuid; v_team uuid;
  v_client uuid; v_job uuid; v_deliv uuid; v_sub uuid;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_assignee is null then
    raise exception 'an assignee is required' using errcode = '22023';
  end if;

  -- the assignee's placement, checked against the caller's write scope.
  select department_id, team_id into v_dept, v_team
  from user_profiles where id = p_assignee and tenant_id = v_tenant;
  if not (app.has_permission('project_tasks', 'manage') and app.in_write_scope(v_dept, v_team, null)) then
    raise exception 'assigning this task is outside your scope' using errcode = '42501';
  end if;

  -- Reviewer validation (ADR-0036 L6.7). Tenant isolation FIRST (user_holds_permission is not
  -- tenant-filtered), then reviews:moderate held by role OR the per-user overlay.
  if p_reviewer is not null then
    if not exists (select 1 from user_profiles up where up.id = p_reviewer and up.tenant_id = v_tenant) then
      raise exception 'that reviewer is not in your organization' using errcode = '22023';
    end if;
    if not app.user_holds_permission(p_reviewer, 'reviews', 'moderate') then
      raise exception 'the chosen reviewer cannot moderate reviews' using errcode = '22023';
    end if;
    -- No self-review (PERMANENT): the named reviewer may not be the assignee.
    if p_reviewer = p_assignee then
      raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '22023';
    end if;
  end if;

  -- get-or-create the tenant-level "Ad-hoc" internal client + job (fenced from external surfaces).
  select id into v_client from clients
    where tenant_id = v_tenant and is_internal and internal_kind = 'tenant' limit 1;
  if v_client is null then
    insert into clients (tenant_id, name, is_internal, internal_kind)
    values (v_tenant, 'Internal', true, 'tenant') returning id into v_client;
  end if;
  select id into v_job from jobs
    where tenant_id = v_tenant and client_id = v_client and name = 'Ad-hoc assignments' limit 1;
  if v_job is null then
    insert into jobs (tenant_id, client_id, name)
    values (v_tenant, v_client, 'Ad-hoc assignments') returning id into v_job;
  end if;

  insert into deliverables (tenant_id, job_id, name, state, reviewer_id, due_at)
  values (v_tenant, v_job, trim(p_title), 'in_progress', p_reviewer, p_due_at)
  returning id into v_deliv;

  insert into sub_tasks (tenant_id, deliverable_id, department_id, team_id, assignee_id,
                         title, sla_hours, starts_at, due_at, status, created_by)
  values (v_tenant, v_deliv, v_dept, v_team, p_assignee,
          trim(p_title), p_hours, p_starts_at, p_due_at, 'todo', auth.uid())
  returning id into v_sub;

  sub_task_id := v_sub; deliverable_id := v_deliv; return next;
end $$;

comment on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) is
  'ADR-0035/0036: create an ad-hoc reviewable deliverable + its sub-task. Gated project_tasks:manage '
  '+ in_write_scope over the assignee; the named reviewer must be in-tenant AND hold reviews:moderate '
  'by role OR the per-user overlay (app.user_holds_permission). No self-review (permanent).';

revoke execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) from public;
grant  execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) to authenticated;

commit;
