-- ADR-0035 (I11.1): ad-hoc assigned work becomes a reviewable deliverable with an assigner-chosen
-- reviewer. The review stack is deliverable-scoped (media_records/review_feedback/ReviewPanel/
-- in_review sign-off), so an ad-hoc scheduler assignment now creates a lightweight deliverable +
-- sub-task under a tenant-level "Ad-hoc" internal job, instead of a deliverable-less standalone task
-- (supersedes ADR-0034 for review-needing work; deliverable_id stays nullable but ad-hoc tasks now
-- carry a real deliverable). Forward-only; additive.

-- 1. designated reviewer on a deliverable. NULL = role-based review (any reviews:moderate holder),
--    exactly as campaign deliverables behave today; set = that specific person is the reviewer.
alter table deliverables add column reviewer_id uuid references user_profiles(id);
comment on column deliverables.reviewer_id is
  'Assigner-chosen reviewer for an ad-hoc deliverable (ADR-0035); notified when the assignee submits. '
  'NULL = role-based review (any reviews:moderate holder), as for campaign deliverables.';

-- 2. one-call ad-hoc assignment. SECURITY DEFINER (writes the fenced internal client/job + the
--    deliverable/sub-task across RLS) but gated on project_tasks:manage + write scope over the
--    assignee — the same authority the sub_task write RLS enforces for a normal assignment.
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

  -- a named reviewer must be able to sign off (reviews:moderate is required to approve a deliverable).
  if p_reviewer is not null and not exists (
    select 1 from role_grants rg
    join user_profiles up on up.role_id = rg.role_id
    where up.id = p_reviewer and up.tenant_id = v_tenant
      and rg.resource = 'reviews' and rg.action = 'moderate'
  ) then
    raise exception 'the chosen reviewer cannot moderate reviews' using errcode = '22023';
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
  'ADR-0035: create an ad-hoc reviewable deliverable + its sub-task under the tenant Ad-hoc job, with '
  'an assigner-chosen reviewer. Gated project_tasks:manage + in_write_scope over the assignee.';

revoke execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) from public;
grant  execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) to authenticated;

-- 3. when the assignee submits (sub-task status → review), notify the deliverable's designated
--    reviewer (if any). Role-based deliverables (reviewer_id null) are unaffected.
create or replace function app.tg_subtask_notify_reviewer()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare v_reviewer uuid; v_name text;
begin
  if new.status <> 'review' or new.status is not distinct from old.status then
    return new;
  end if;
  select d.reviewer_id, d.name into v_reviewer, v_name
  from deliverables d where d.id = new.deliverable_id;
  if v_reviewer is null or v_reviewer is not distinct from auth.uid() then
    return new;  -- no designated reviewer, or the actor is the reviewer
  end if;
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  values (new.tenant_id, v_reviewer, 'review_requested', coalesce(v_name, new.title), 'deliverable', new.deliverable_id, auth.uid());
  return new;
end $$;

create trigger subtask_notify_reviewer after update of status on sub_tasks
  for each row execute function app.tg_subtask_notify_reviewer();
