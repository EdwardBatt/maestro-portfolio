-- L6.5 (ADR-0036): revert the TEMP alpha toggles TMP.1/1a/2/3 — restore deny-by-default booking
-- write-scope, the ad-hoc RPC scope gate, review-moderation to reviews:moderate, and the task-edit
-- scope gate. Per-user overlay (user_grants/user_scope_grants) now carries the exceptions.

begin;

-- ============================================================================
-- A) TMP.1 — booking scope + blanket grants
-- ============================================================================

-- A.1) Reproduce app.seed_tenant_roles EXACTLY from 20260820040000, MINUS the "TEMPORARY (alpha)"
--      blanket-grant block (schedule:view + bookings:create/update/delete cross-joined onto every
--      non-portal role). Everything else — the per-role grant inserts, directory:view, the
--      system_op fencing — is identical.
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
    ('bookings','create'),('bookings','update'),('bookings','approve'),
    ('project_tasks','manage'),('exceptions','view'),('reviews','moderate'),
    ('kpi','manage')
  ) as g(r,a) on conflict do nothing;

  -- Deputy clones the Team Leader's grants (incl. the new reviews:moderate).
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_deputy, resource, action from role_grants where role_id = v_teamlead on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_member, r, a from (values
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
-- (source: 20260820040000_alpha_all_users_edit_schedule.sql, reproduced verbatim minus the alpha
--  blanket-grant block at its lines ~124-134.)

-- A.2) Surgically remove the already-applied alpha blanket grants. Removing the block from the
--      seeder does NOT delete existing rows, so delete the illegitimate extras — the role/grant
--      pairs the authoritative per-role lists above do NOT include. scheduler and department_lead
--      legitimately hold all four (schedule:view + bookings create/update/delete), so they are NOT
--      touched. Fenced with app.system_op ('on' before / 'off' after) — these are grant rows on
--      non-system roles, but we set the fence to be safe.
--
--      ASSUMPTION / JUDGMENT CALL: this deletes exactly the alpha over-grant. If an admin had
--      *legitimately* granted one of these role/action pairs via the Roles screen during the alpha,
--      this DELETE would remove it too (there is no marker distinguishing an alpha blanket row from
--      a hand-added one). Accepted for the alpha revert — flagged.
select set_config('app.system_op', 'on', true);

delete from role_grants rg
using roles r
where rg.role_id = r.id
  and rg.resource = 'schedule' and rg.action = 'view'
  and r.key in ('team_member');

delete from role_grants rg
using roles r
where rg.role_id = r.id
  and rg.resource = 'bookings' and rg.action = 'create'
  and r.key in ('team_member','account_manager','ceo','coo','cfo');

delete from role_grants rg
using roles r
where rg.role_id = r.id
  and rg.resource = 'bookings' and rg.action = 'update'
  and r.key in ('team_member','account_manager','ceo','coo','cfo');

delete from role_grants rg
using roles r
where rg.role_id = r.id
  and rg.resource = 'bookings' and rg.action = 'delete'
  and r.key in ('team_member','account_manager','team_lead','deputy_team_lead','ceo','coo','cfo');

select set_config('app.system_op', 'off', true);

-- A.3) Restore the scoped booking-write policies. bookings_scheduler_insert / _update come back
--      with the write-scope + PM-bypass authority; bookings_scheduler_delete comes back with the
--      write-scope authority.
drop policy bookings_scheduler_insert on bookings;
create policy bookings_scheduler_insert on bookings
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'create')
    and (app.resource_in_write_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)));

drop policy bookings_scheduler_update on bookings;
create policy bookings_scheduler_update on bookings
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and (app.resource_in_write_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)))
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and (app.resource_in_write_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)));
-- (source: bookings_scheduler_insert / _update from 20260819140000_pm_booking_authority.sql.)

drop policy bookings_scheduler_delete on bookings;
create policy bookings_scheduler_delete on bookings
  for delete to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'delete')
    and app.resource_in_write_scope(resource_id));
-- (source: bookings_scheduler_delete from 20260812120100_scope_helpers_and_policies.sql.)

-- No reseed: we deliberately do NOT run `select app.seed_tenant_roles(id) from tenants;`. The alpha
-- blanket block is gone from the seeder, so reseeding would add nothing new; the surgical DELETE in
-- A.2 already removes the existing over-granted rows. Reseeding is unnecessary.

-- ============================================================================
-- B) TMP.1a + TMP.2 — the ad-hoc RPC and review moderation
-- ============================================================================

-- B.4) Restore public.create_adhoc_deliverable to the ORIGINAL: both the combined scope guard
--      (project_tasks:manage AND app.in_write_scope) AND the "chosen reviewer must hold
--      reviews:moderate" check. This single reproduction reverts TMP.1a (scope) and TMP.2's change
--      to this function. (The no-self-review guard was added later and is permanent — see the note
--      below.)
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

  -- No self-review (PERMANENT): the named reviewer may not be the assignee. A person can't sign off
  -- their own work. (The reviewer picker already excludes the assignee; this is the authoritative gate.)
  if p_reviewer is not null and p_reviewer = p_assignee then
    raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '22023';
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
  'an assigner-chosen reviewer. Gated project_tasks:manage + in_write_scope over the assignee; the '
  'named reviewer must hold reviews:moderate. No self-review (permanent).';

revoke execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) from public;
grant  execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) to authenticated;
-- (source: 20260820010000_adhoc_reviewable_deliverables.sql for the scope + reviewer-moderate
--  checks; the no-self-review guard retained from 20260820060000 as it is permanent.)

-- B.5) The TMP.2 helper app.can_moderate_deliverable is dropped BELOW (B.9a). It can't be dropped
--      here: the live deliverables_reviewer_update and review_feedback_resolve_update policies still
--      depend on it (hard pg_depend edges) until B.6 and B.9 recreate them off app.has_permission.
--      Postgres refuses `drop function` while a policy references it (SQLSTATE 2BP01).

-- B.6) Restore deliverables_reviewer_update to the reviews:moderate USING/WITH CHECK form.
drop policy deliverables_reviewer_update on deliverables;
create policy deliverables_reviewer_update on deliverables
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('reviews', 'moderate'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('reviews', 'moderate'));
-- (source: deliverables_reviewer_update from 20260817110100_deliverable_lifecycle_engine.sql.)

-- B.7) Restore app.tg_deliverable_transition_guard to the bare has_review / (has_review or
--      has_manage) authority form.
create or replace function app.tg_deliverable_transition_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_actor   uuid := auth.uid();
  has_manage boolean := app.has_permission('project_tasks', 'manage');
  has_review boolean := app.has_permission('reviews', 'moderate');
  allowed   deliverable_state[];
  ev        text := null;
  att       attribution_party := null;
begin
  -- Reviewer-only actors may change nothing but the workflow state.
  if not has_manage then
    if new.name        is distinct from old.name
       or new.stream_id is distinct from old.stream_id
       or new.job_id    is distinct from old.job_id
       or new.due_at    is distinct from old.due_at
       or new.revision_limit is distinct from old.revision_limit
       or new.tenant_id is distinct from old.tenant_id then
      raise exception 'deliverable: reviewers may change only workflow state' using errcode = '42501';
    end if;
  end if;

  -- Nothing to police unless the workflow state actually moves.
  if new.state is not distinct from old.state then
    new.revision_round := old.revision_round;   -- never client-writable
    return new;
  end if;

  -- Legal transition graph (ADR-0024).
  allowed := case old.state
    when 'draft'       then array['in_progress','archived']::deliverable_state[]
    when 'in_progress' then array['in_review','blocked','archived']::deliverable_state[]
    when 'blocked'     then array['in_progress','archived']::deliverable_state[]
    when 'in_review'   then array['approved','in_progress']::deliverable_state[]
    when 'approved'    then array['delivered','in_progress','archived']::deliverable_state[]
    when 'delivered'   then array['archived','in_progress']::deliverable_state[]
    when 'archived'    then array[]::deliverable_state[]
    else array[]::deliverable_state[]
  end;
  if not (new.state = any(allowed)) then
    raise exception 'deliverable: illegal transition % -> %', old.state, new.state using errcode = '22023';
  end if;

  -- ADR-0030 readiness gate: review/approval need every sub-task submitted. An open (todo/
  -- in_progress) sub-task — including one reopened by Request Changes — holds the gate shut.
  if new.state in ('in_review', 'approved') then
    if exists (select 1 from sub_tasks st
               where st.deliverable_id = new.id and st.status in ('todo', 'in_progress', 'blocked')) then
      raise exception 'deliverable: every sub-task must be submitted before % (open sub-tasks remain)', new.state
        using errcode = '55000';
    end if;
  end if;

  -- Authority per transition.
  if new.state = 'approved' then
    if not has_review then
      raise exception 'deliverable: sign-off (-> approved) requires reviews:moderate' using errcode = '42501';
    end if;
  elsif old.state = 'in_review' and new.state = 'in_progress' then
    if not (has_review or has_manage) then
      raise exception 'deliverable: send-back requires reviews:moderate or project_tasks:manage' using errcode = '42501';
    end if;
  else
    if not has_manage then
      raise exception 'deliverable: this transition requires project_tasks:manage' using errcode = '42501';
    end if;
  end if;

  -- Revision round: a rework cycle (back into in_progress from review/approved) counts a round.
  if new.state = 'in_progress' and old.state in ('in_review','approved') then
    new.revision_round := old.revision_round + 1;
  else
    new.revision_round := old.revision_round;
  end if;

  -- Append-only event for the accountability log (Phase 2 reads this).
  if new.state = 'approved' then ev := 'approved'; att := 'approver';
  elsif old.state = 'in_review' and new.state = 'in_progress' then ev := 'revision_requested'; att := 'assignee';
  elsif new.state = 'blocked' then ev := 'blocked_flagged'; att := 'dependency';
  elsif old.state = 'blocked' and new.state = 'in_progress' then ev := 'block_cleared'; att := null;
  end if;
  if ev is not null then
    insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
    values (old.tenant_id, old.id, ev, att, v_actor,
            jsonb_build_object('from', old.state, 'to', new.state, 'revision_round', new.revision_round));
  end if;

  return new;
end $$;
-- (source: app.tg_deliverable_transition_guard from 20260819150000_deliverable_approval_gate.sql.)

-- B.8) Restore app.sub_task_request_changes to the bare `if not app.has_permission('reviews',
--      'moderate')` gate (reopen-to-todo variant, with the changes_requested notification).
create or replace function app.sub_task_request_changes(p_sub_task uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks; v_deliv_state deliverable_state; v_has_comment boolean;
begin
  if not app.has_permission('reviews', 'moderate') then
    raise exception 'requesting changes requires reviews:moderate' using errcode = '42501';
  end if;
  select * into v from sub_tasks where id = p_sub_task;
  if v.id is null then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;
  if v.status <> 'review' then
    raise exception 'changes can only be requested on a submitted (review) sub-task (is %)', v.status using errcode = '22023';
  end if;

  -- a change description is mandatory: at least one unresolved review comment on this deliverable.
  select exists (
    select 1 from review_feedback rf
    join media_records mr on mr.id = rf.media_record_id
    where mr.deliverable_id = v.deliverable_id and coalesce(rf.resolved, false) = false
  ) into v_has_comment;
  if not v_has_comment then
    raise exception 'a change description (an unresolved review comment) is required to request changes'
      using errcode = '55000';
  end if;

  -- Reopen to TODO (not in_progress) so the maker Starts a fresh timed round before resubmitting.
  update sub_tasks set status = 'todo', revision_number = revision_number + 1 where id = p_sub_task;

  -- notify the assignee that changes were requested on their task
  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'changes_requested', v.title, 'sub_task', p_sub_task, auth.uid());
  end if;

  -- send the deliverable back if it is in review (fires the guard → revision_round++ + event)
  select state into v_deliv_state from deliverables where id = v.deliverable_id;
  if v_deliv_state = 'in_review' then
    update deliverables set state = 'in_progress' where id = v.deliverable_id;
  end if;
end $$;
-- (source: app.sub_task_request_changes from 20260820030000_request_changes_reopens_todo.sql.)

-- B.9) Restore review_feedback_resolve_update to the author-or-moderate form.
drop policy review_feedback_resolve_update on review_feedback;
create policy review_feedback_resolve_update on review_feedback
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (author_user_id = auth.uid() or app.has_permission('reviews', 'moderate'))
  )
  with check (tenant_id = app.current_tenant_id());
-- (source: review_feedback_resolve_update from 20260818110000_review_feedback_grants_and_rounds.sql.)

-- B.9a) Now that no POLICY references it, drop the TMP.2 per-deliverable moderation helper. The
--       transition guard (B.7) and sub_task_request_changes (B.8) also referenced it, but function
--       BODY references do not create pg_depend edges and never blocked the drop — only the two
--       policies (B.6/B.9) did, and both are now recreated off app.has_permission.
drop function if exists app.can_moderate_deliverable(uuid);
-- (source: reverses 20260820060000_alpha_designated_reviewer_signoff.sql step 1.)

-- ============================================================================
-- C) TMP.3 — task-edit RPC
-- ============================================================================

-- C.10) Restore the scope check to public.update_task_assignment. The sub_tasks fetch (and its
--       not-found check) is moved to BEFORE the permission gate so v.department_id / v.team_id /
--       v.deliverable_id are available to the write-scope check. Everything else (updated_by
--       stamping via trigger, no-self-review, the rest of the body) is identical to 20260820070000.
create or replace function public.update_task_assignment(
  p_sub_task   uuid,
  p_title      text,
  p_assignee   uuid,
  p_reviewer   uuid default null,
  p_starts_at  timestamptz default null,
  p_due_at     timestamptz default null,
  p_hours      numeric default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean)
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v sub_tasks%rowtype;
  v_reassigned boolean;
  v_dates_changed boolean;
begin
  -- Fetch the target sub-task FIRST so its placement is available to the scope gate below.
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

  -- project_tasks:manage AND write scope over the task's own placement / owning AM (restored L6.5).
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id, app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'editing this task requires project-task management permission' using errcode = '42501';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_assignee is null then
    raise exception 'an assignee is required' using errcode = '22023';
  end if;
  if not exists (select 1 from user_profiles where id = p_assignee and tenant_id = v_tenant) then
    raise exception 'that assignee is not in your organization' using errcode = '22023';
  end if;
  if p_reviewer is not null and not exists (
    select 1 from user_profiles where id = p_reviewer and tenant_id = v_tenant
  ) then
    raise exception 'that reviewer is not in your organization' using errcode = '22023';
  end if;
  -- No self-review (PERMANENT): the reviewer may not be the assignee.
  if p_reviewer is not null and p_reviewer = p_assignee then
    raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '22023';
  end if;

  v_reassigned := p_assignee is distinct from v.assignee_id;
  v_dates_changed := (p_starts_at is not null and p_starts_at is distinct from v.starts_at)
                  or (p_due_at    is not null and p_due_at    is distinct from v.due_at)
                  or (p_hours     is not null and p_hours     is distinct from v.sla_hours);

  update sub_tasks set
    title       = trim(p_title),
    assignee_id = p_assignee,
    starts_at   = coalesce(p_starts_at, starts_at),
    due_at      = coalesce(p_due_at, due_at),
    sla_hours   = coalesce(p_hours, sla_hours),
    -- reset the human-override flag so subtask-schedule rebuilds the booking on reassign / date change
    schedule_overridden = case when v_reassigned or v_dates_changed then false else schedule_overridden end
  where id = p_sub_task;

  -- parent deliverable: set the designated reviewer always; only rename an AD-HOC deliverable
  -- (stream_id null) — never rename a project (stream-backed) deliverable from a booking edit.
  if v.deliverable_id is not null then
    update deliverables set
      reviewer_id = p_reviewer,
      name = case when stream_id is null then trim(p_title) else name end
    where id = v.deliverable_id;
  end if;

  -- keep the linked booking's title column in step (chip label for ad-hoc comes via deliverable name).
  -- Qualify bookings.sub_task_id — the OUT parameter sub_task_id would otherwise shadow it.
  update bookings set title = trim(p_title) where bookings.sub_task_id = p_sub_task;

  sub_task_id := p_sub_task;
  deliverable_id := v.deliverable_id;
  reschedule_needed := v_reassigned or v_dates_changed;
  return next;
end $$;

comment on function public.update_task_assignment(uuid, text, uuid, uuid, timestamptz, timestamptz, numeric) is
  'I11.7: edit a task (title, assignee, reviewer, dates/hours) from the schedule modal. Gated '
  'project_tasks:manage + in_write_scope over the task placement/owning AM (L6.5 restore). No '
  'self-review (permanent). Resets schedule_overridden on reassign/date change so subtask-schedule '
  're-materialises the booking.';

revoke execute on function public.update_task_assignment(uuid, text, uuid, uuid, timestamptz, timestamptz, numeric) from public;
grant  execute on function public.update_task_assignment(uuid, text, uuid, uuid, timestamptz, timestamptz, numeric) to authenticated;
-- (source: 20260820070000_task_edit_and_audit.sql, with the in_write_scope gate restored and the
--  sub_tasks fetch moved ahead of the permission gate.)

commit;
