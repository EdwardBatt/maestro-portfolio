-- A refusal names the PEOPLE who can, not the roles (I54.20).
--
-- Edward, 23 Sep: *"Error messages must be explicit, they should state who to contact if they need
-- a task reordered."* `I54.18` did the reorder one; these are the other eight, and they are the
-- reason `coverage/deliverables-page` stayed red — that walk presses add, edit, reorder, cancel and
-- remove in one go, so fixing one of five changed nothing.
--
-- Two faults in every one of them, both exposed rather than caused by `I53.28` (22 Sep), which
-- stopped the dialog INVENTING a sentence for any 42501 and made it show the server's own words:
--
--   1. "outside your **scope**" where every other refusal says "outside your **reach**". It is the
--      same check underneath (`app.in_write_scope`), so there was never a distinction to carry.
--   2. Nobody named. The person is stopped with nowhere to go, so they ask in a chat or give up.
--
-- **The pattern copied here already existed and is better than naming roles**: `20260916110000`
-- (I49.66) put the deliverable OWNER'S NAME in a refused edit — Edward, 16 Sep: *"if you need it
-- edited please contact <deliverable owner>"*. This generalises that to the whole family.
--
-- **Shape.** Each raise now carries three things: a complete English sentence (what a log, a test,
-- or any surface not yet wired reads), `detail` = the names, and `hint` = a stable key for the
-- action. The client translates from the key and interpolates the names, so an Arabic reader gets
-- an Arabic refusal with the same names — which a sentence built in the database can never do.
--
-- **Who is named, per action, read off that function's own gate — no new rule is invented:**
--   remove / cancel / reinstate a task   the deliverable's owner (the edit refusal's own choice)
--   give somebody ad-hoc work            whoever may approve work for that person
--   approve / re-open a department brief that department's approvers on that campaign
--   promote a job / attach a job         the campaign's account manager
--
-- Nothing about WHO MAY DO WHAT changes. Only the sentence. Every function is reproduced whole
-- because migrations are forward-only; `create or replace` keeps the existing grants.

begin;

-- ---- the name lookups ------------------------------------------------------------
-- Plain STABLE sql, not security definer: they read `user_profiles`, which is already readable
-- tenant-wide, so no elevation is needed and none is taken (AGENTS.md §6).

create or replace function app.refusal_ask(p_names text) returns text
language sql immutable as $$
  -- The tail of the sentence. When nobody can be named — an unowned deliverable, a department with
  -- no approver yet — it still says where to go rather than trailing off.
  select case when coalesce(btrim(p_names), '') = ''
              then ' Ask your department lead or Traffic.'
              else ' Ask ' || p_names || '.' end
$$;

comment on function app.refusal_ask(text) is
  'I54.20: the "who to ask" tail of a refusal. Never empty — a refusal that names nobody is the '
  'fault this was written to fix.';

create or replace function app.refusal_names_deliverable_owner(p_deliverable uuid) returns text
language sql stable set search_path = public, app, extensions as $$
  select p.display_name
    from deliverables d
    left join user_profiles p on p.id = d.owner_user_id
   where d.id = p_deliverable
$$;

create or replace function app.refusal_names_assignee_leads(p_assignee uuid) returns text
language sql stable set search_path = public, app, extensions as $$
  -- Whoever may approve work for this person — the same list ADR-0087's request path already asks.
  select string_agg(a.display_name, ', ' order by a.display_name)
    from resources r
    cross join lateral public.assignment_request_approvers(r.id) a
   where r.user_id = p_assignee and r.is_active
$$;

create or replace function app.refusal_names_brief_approvers(p_campaign uuid, p_department uuid)
returns text
language sql stable set search_path = public, app, extensions as $$
  -- The list step 5 of the wizard already shows: computed in Postgres from grants and scope, never
  -- from role names (ADR-0073, 20260906100000).
  select string_agg(a.display_name, ', ' order by a.display_name)
    from public.department_brief_approvers(p_campaign) a
   where a.department_id = p_department
$$;

create or replace function app.refusal_names_campaign_am(p_campaign uuid) returns text
language sql stable set search_path = public, app, extensions as $$
  select p.display_name
    from user_profiles p
   where p.id = app.campaign_account_manager(p_campaign)
$$;

-- ---- the eight refusals ----------------------------------------------------------

-- ---- remove_sub_task -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_sub_task(p_sub_task uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v sub_tasks;
  v_worked boolean;
  v_logged boolean;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  -- Same authority as assigning it: whoever may give this work out may take it away.
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id,
                                 app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'You cannot remove this task: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(v.deliverable_id))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(v.deliverable_id), ''),
            hint = 'remove_task';
  end if;

  select exists (select 1 from task_time_entries te where te.sub_task_id = p_sub_task)
    into v_worked;
  -- I49.67: the log is a record too. A commitment stamped, a deadline moved, an extension asked
  -- for — any of these makes the task history, and history is cancelled, never deleted (the FK
  -- would refuse the delete anyway; this makes the answer a cancellation rather than an error).
  select exists (select 1 from sla_events e where e.sub_task_id = p_sub_task)
    into v_logged;

  -- A PLAN: unassigned, still todo, never worked on, never recorded. The first three are the
  -- approval gate's predicate (ADR-0052 d.10); the fourth is what the log adds.
  if v.assignee_id is null and v.status = 'todo' and not v_worked and not v_logged then
    delete from sub_tasks where id = p_sub_task;
    return 'deleted';
  end if;

  -- Anything else keeps its record. `sub_task_cancel` frees the calendar and audits.
  perform public.sub_task_cancel(p_sub_task);
  return 'cancelled';
end $function$;

-- ---- sub_task_cancel -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sub_task_cancel(p_sub_task uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare v sub_tasks; v_stream uuid; v_live integer;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  if v.status = 'cancelled' then
    return;                                   -- idempotent: cancelling twice is not an error
  end if;
  if v.status = 'done' then
    raise exception 'an approved task cannot be cancelled — it is already complete'
      using errcode = '22023';
  end if;

  -- Same authority as assigning it: whoever may give this work out may call it off.
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id,
                                 app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'You cannot cancel this task: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(v.deliverable_id))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(v.deliverable_id), ''),
            hint = 'cancel_task';
  end if;

  update sub_tasks set status = 'cancelled' where id = p_sub_task;

  -- Free the calendar. Cancelled work must stop consuming capacity, or the schedule keeps telling
  -- everyone that person is busy.
  delete from bookings where sub_task_id = p_sub_task;

  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'cancelled', v.title, 'sub_task', v.id, auth.uid());
  end if;

  -- ADR-0061 d.6. An AD-HOC deliverable IS its task, so cancelling the last live one settles it.
  -- `archived` rather than `cancelled`: the deliverable states are draft/in_progress/in_review/
  -- approved/delivered/archived, and archived is the one that means "off the live list, kept for
  -- the record" — which is exactly what a called-off ad-hoc job is.
  --
  -- app.is_system_op() so the transition guard treats this as the consequence of an authorised act
  -- rather than a hand-made state change, the same way the materialiser is treated.
  if v.deliverable_id is not null then
    select d.stream_id into v_stream from deliverables d where d.id = v.deliverable_id;
    if v_stream is null then
      select count(*) into v_live from sub_tasks st
       where st.deliverable_id = v.deliverable_id
         and st.status not in ('cancelled', 'done');
      if v_live = 0 then
        perform set_config('app.system_op', 'on', true);
        update deliverables set state = 'archived'
         where id = v.deliverable_id and state <> 'archived';
        perform set_config('app.system_op', 'off', true);
      end if;
    end if;
  end if;
end $function$;

-- ---- sub_task_reinstate ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.sub_task_reinstate(p_sub_task uuid, p_assigning boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v sub_tasks;
  v_stream uuid;
  v_state  deliverable_state;
  v_owner  uuid;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  -- Only from `cancelled`. Anything else is either already live or finished, and "reinstating" it
  -- would be a silent status rewrite rather than an undo.
  if v.status <> 'cancelled' then
    raise exception 'only a cancelled task can be reinstated' using errcode = '22023';
  end if;

  -- The same authority that cancelled it: whoever may call work off may call it back on. Mirrors
  -- `sub_task_cancel` exactly rather than inventing a second rule that can drift from it.
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id,
                                 app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'You cannot reinstate this task: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(v.deliverable_id))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(v.deliverable_id), ''),
            hint = 'reinstate_task';
  end if;

  -- Ad-hoc work whose job was archived by its own cancellation cannot come back, because the job
  -- cannot — so refuse rather than produce a live task under a dead container.
  if v.deliverable_id is not null then
    select d.stream_id, d.state, d.owner_user_id into v_stream, v_state, v_owner
      from deliverables d where d.id = v.deliverable_id;
    if v_stream is null and v_state = 'archived' then
      raise exception
        'ad-hoc work cannot be reinstated: cancelling it closed the job, and an archived job is final'
        using errcode = '22023';
    end if;
  end if;

  update sub_tasks
     set status      = 'todo',
         assignee_id = null
   where id = p_sub_task;

  -- The caller is assigning it now: the assignment says so (ADR-0061), nothing else needs to.
  if p_assigning then
    return;
  end if;

  -- It comes back unassigned: tell the people who can put it on a calendar. Department-scoped
  -- holders of bookings:create over the task's department, team-scoped holders over its team (or
  -- over the department's teams when the task names none), and the deliverable's owner. The scope
  -- test mirrors public.assignment_request_approvers over the task instead of a resource. Never the
  -- caller, and never the former assignee — there is nothing for them to do.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select distinct v.tenant_id, r.user_id, 'task_reinstated', v.title, 'sub_task', v.id, auth.uid()
    from (
      select up.id as user_id
        from public.user_profiles up
        join public.roles r on r.id = up.role_id
       where up.tenant_id = v.tenant_id and up.is_active
         and app.user_has_permission(up.id, 'bookings', 'create')
         and (
           (r.scope = 'department' and up.department_id is not null and (
               up.department_id = v.department_id
               or (v.team_id is not null and exists (
                     select 1 from public.teams t
                     where t.id = v.team_id and t.department_id = up.department_id))))
           or
           (r.scope = 'team' and up.team_id is not null and (
               (v.team_id is not null and v.team_id = up.team_id)
               or (v.team_id is null and v.department_id is not null and exists (
                     select 1 from public.teams t
                     where t.id = up.team_id and t.department_id = v.department_id))))
         )
      union
      select v_owner where v_owner is not null
    ) r
   where r.user_id is distinct from auth.uid();
end $function$;

-- ---- create_adhoc_deliverable ----------------------------------------------
CREATE OR REPLACE FUNCTION public.create_adhoc_deliverable(p_assignee uuid, p_title text, p_hours numeric, p_starts_at timestamp with time zone, p_due_at timestamp with time zone, p_reviewer uuid DEFAULT NULL::uuid)
 RETURNS TABLE(sub_task_id uuid, deliverable_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
    raise exception 'You cannot give this person work: they are outside your reach.%',
            app.refusal_ask(app.refusal_names_assignee_leads(p_assignee))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_assignee_leads(p_assignee), ''),
            hint = 'create_adhoc';
  end if;

  -- Reviewer validation (ADR-0036 L6.7). Tenant isolation FIRST (user_holds_permission is not
  -- tenant-filtered), then reviews:moderate held by role OR the per-user overlay.
  -- ADR-0038: a task may not be assigned without a reviewer appointed. The old optional parameter
  -- backed the "Any reviewer (role-based)" option, which stored NULL and reached no inbox at all.
  if p_reviewer is null then
    raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
  end if;
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

  -- I20.5 (ADR-0053 d.6). `owner_user_id` added 2026-08-29, and NOT `department_id` beside it:
  -- `app.tg_deliverable_stamp_department` derives that from the owner on this very insert, and
  -- writing both here would be the one way to make the pair disagree.
  insert into deliverables (tenant_id, job_id, name, state, reviewer_id, due_at, owner_user_id)
  values (v_tenant, v_job, trim(p_title), 'in_progress', p_reviewer, p_due_at, p_assignee)
  returning id into v_deliv;

  insert into sub_tasks (tenant_id, deliverable_id, department_id, team_id, assignee_id,
                         title, sla_hours, starts_at, due_at, status, created_by)
  values (v_tenant, v_deliv, v_dept, v_team, p_assignee,
          trim(p_title), p_hours, p_starts_at, p_due_at, 'todo', auth.uid())
  returning id into v_sub;

  -- ADR-0043 d.9: the same person on BOTH homes, written here rather than left to the seed trigger
  -- so the intent is visible at the call site. (The seed trigger has already done it, from the
  -- deliverable this function just wrote; the guard is what makes saying it twice harmless.)
  -- ADR-0089 d.2: and that one person is the REQUIRED reviewer — the ad-hoc dialog's single select
  -- produces a required appointment with no change to the screen (d.13).
  --
  -- NOT `on conflict (sub_task_id, user_id)`: a conflict target is an expression context, and
  -- `sub_task_id` is this function's OUT parameter, so plpgsql binds the name to the variable and
  -- raises 42702 "column reference is ambiguous". `where not exists` keeps every name qualified.
  insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
  select v_tenant, v_sub, p_reviewer, true, auth.uid()
  where not exists (
    select 1 from sub_task_reviewers r where r.sub_task_id = v_sub and r.user_id = p_reviewer);
  update sub_task_reviewers r set is_mandatory = true
   where r.sub_task_id = v_sub and r.user_id = p_reviewer and not r.is_mandatory;

  sub_task_id := v_sub; deliverable_id := v_deliv; return next;
end $function$;

-- ---- promote_single_job ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_single_job(p_campaign uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v campaigns;
  v_prior text;
  v_job_brief campaign_briefs;
  v_words text;
  v_task text;
  v_next jsonb;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;

  -- d.11: one way, and a second press is an error rather than a silent success — the modal has just
  -- said "this cannot be undone", and a no-op would make that sentence false in the other direction.
  if v.kind <> 'single_job' then
    raise exception 'this is already a campaign' using errcode = '22023';
  end if;

  -- ADR-0073: hold the grant AND be in scope over the campaign's responsible manager. The assigned
  -- AM passes by their account scope, the Account Director by ADR-0074's reach, Power Admin and
  -- Traffic Manager by being tenant-scoped. No role is named.
  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, app.campaign_account_manager(p_campaign)) then
    raise exception 'You cannot promote this job to a campaign: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_campaign_am(p_campaign))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_campaign_am(p_campaign), ''),
            hint = 'promote_job';
  end if;

  -- The job's one brief (ADR-0083 d.3: a single job is a campaign row with one department brief).
  select * into v_job_brief from campaign_briefs
   where campaign_id = p_campaign and tenant_id = app.current_tenant_id()
   order by created_at limit 1;
  v_words := nullif(trim(coalesce(v.brief -> 'request' ->> 'words', '')), '');
  v_task  := nullif(trim(coalesce(v_job_brief.values ->> 'task', '')), '');

  -- 1. The words become the campaign's brief. `kind` was the request record's marker and is not a
  --    field; the record itself (`request`) stays where it was.
  v_next := coalesce(v.brief, '{}'::jsonb) - 'kind';
  if v_words is not null and nullif(trim(coalesce(v_next ->> 'background', '')), '') is null then
    v_next := v_next || jsonb_build_object('background', v_words);
  end if;
  if v_task is not null and nullif(trim(coalesce(v_next ->> 'task', '')), '') is null then
    v_next := v_next || jsonb_build_object('task', v_task);
  end if;
  if v_job_brief.id is not null then
    v_next := v_next || jsonb_build_object('promotedJobBrief', jsonb_build_object(
      'briefType', v_job_brief.brief_type, 'values', v_job_brief.values,
      'approvedAt', v_job_brief.approved_at, 'approvedBy', v_job_brief.approved_by));
  end if;

  v_prior := coalesce(current_setting('app.campaign_kind_change', true), '');
  perform set_config('app.campaign_kind_change', 'on', true);
  update campaigns set kind = 'campaign', brief = v_next
   where id = p_campaign and tenant_id = app.current_tenant_id();
  perform set_config('app.campaign_kind_change', v_prior, true);

  -- 2. The department writes its own brief for the campaign: the job's row is re-opened and
  --    emptied, so the tab offers Generate and the gate holds new assignments (ADR-0072 d.6).
  --    Re-opening goes through the door that exists for it — reopen_department_brief, audited as
  --    department_brief_reopened — because an approved row is closed to every direct write
  --    (I51.3); every role that may promote also holds briefs:approve, so the door is open to
  --    them. The emptying is an ordinary write on the now-unapproved row, under its own policy.
  if v_job_brief.id is not null then
    perform public.reopen_department_brief(v_job_brief.id);
    update campaign_briefs
       set "values" = '{}'::jsonb
     where id = v_job_brief.id;
    if not found then
      raise exception 'the job''s brief could not be reset for the department' using errcode = '42501';
    end if;
    insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
    values (v.tenant_id, auth.uid(), 'department_brief_reset_on_promotion', 'campaign_briefs', v_job_brief.id,
            jsonb_build_object('campaign_id', p_campaign, 'department_id', v_job_brief.department_id,
                               'brief_type', v_job_brief.brief_type, 'values', v_job_brief.values,
                               'was_approved_at', v_job_brief.approved_at, 'was_approved_by', v_job_brief.approved_by));
  end if;
end $function$;

-- ---- attach_job_to_campaign ------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_job_to_campaign(p_draft_campaign uuid, p_target_campaign uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_tenant        uuid := app.current_tenant_id();
  v_draft         campaigns;
  v_target        campaigns;
  v_target_stream uuid;
  v_moved         uuid[];
  v_first_moved   uuid;
  v_first_name    text;
  v_brief         campaign_briefs;
  v_target_brief  campaign_briefs;
  v_merged        jsonb;
  v_kv            record;
  v_folder        record;
  v_target_folder uuid;
begin
  if p_draft_campaign is null or p_target_campaign is null then
    raise exception 'both campaigns are required' using errcode = '22023';
  end if;
  if p_draft_campaign = p_target_campaign then
    raise exception 'a job cannot be attached to itself' using errcode = '22023';
  end if;

  select * into v_draft from campaigns
   where id = p_draft_campaign and tenant_id = v_tenant;
  if not found then
    raise exception 'campaign % not found', p_draft_campaign using errcode = 'P0002';
  end if;
  select * into v_target from campaigns
   where id = p_target_campaign and tenant_id = v_tenant;
  if not found then
    raise exception 'campaign % not found', p_target_campaign using errcode = 'P0002';
  end if;

  -- d.2: never across clients. The check that offered this only looks at one client's jobs; the
  -- move refuses anything else regardless of what the caller sends.
  if v_draft.client_id <> v_target.client_id then
    raise exception 'a job can only be attached to a job for the same client' using errcode = '22023';
  end if;
  -- The thing being discarded is the single-job DRAFT from SJ-02 — not a released job, which has
  -- its own clock and its own history, and not a campaign.
  if v_draft.kind <> 'single_job' then
    raise exception 'only a single job can be attached to another job' using errcode = '22023';
  end if;
  if v_draft.status = 'approved' then
    raise exception 'this job has already been released; it cannot be attached to another' using errcode = '22023';
  end if;

  -- ADR-0073: the grant, and scope over BOTH campaigns' responsible account managers.
  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, app.campaign_account_manager(p_draft_campaign))
     or not app.in_write_scope(null, null, app.campaign_account_manager(p_target_campaign)) then
    raise exception 'You cannot attach this job to that campaign: one of them is outside your reach.%',
            app.refusal_ask(app.refusal_names_campaign_am(p_draft_campaign))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_campaign_am(p_draft_campaign), ''),
            hint = 'attach_job';
  end if;

  -- From here on the move is a SYSTEM OPERATION: authority was decided above, once. The transition
  -- guard on deliverables would otherwise refuse the stream change to anyone without
  -- project_tasks:manage. Switched off again before returning.
  perform set_config('app.system_op', 'on', true);

  -- 1. THE STREAM. Onto the target's existing stream — a campaign has ONE, named for it (ADR-0050),
  --    and re-parenting the draft's stream would give the target a second one named for a job that
  --    no longer exists. Created only if the target somehow has none.
  select s.id into v_target_stream from streams s
   where s.campaign_id = p_target_campaign
   order by s.created_at, s.id limit 1;
  if v_target_stream is null then
    insert into streams (tenant_id, campaign_id, name)
    values (v_tenant, p_target_campaign, v_target.name)
    returning id into v_target_stream;
  end if;

  -- 2. THE DELIVERABLES. Due date, department, owner and tasks all travel with the row.
  with moved as (
    update deliverables d
       set stream_id = v_target_stream
     where d.stream_id in (select s.id from streams s where s.campaign_id = p_draft_campaign)
    returning d.id, d.name, d.created_at
  )
  select array_agg(id order by created_at, id), (array_agg(id order by created_at, id))[1],
         (array_agg(name order by created_at, id))[1]
    into v_moved, v_first_moved, v_first_name
    from moved;

  -- 3. THE BRIEF. Moved where the department is new to the target; folded in where it is not.
  for v_brief in
    select * from campaign_briefs b where b.campaign_id = p_draft_campaign
  loop
    select * into v_target_brief from campaign_briefs t
     where t.campaign_id = p_target_campaign and t.department_id = v_brief.department_id;

    if not found then
      update campaign_briefs set campaign_id = p_target_campaign where id = v_brief.id;
    else
      v_merged := v_target_brief.values;
      for v_kv in select key, value from jsonb_each_text(v_brief.values) loop
        if coalesce(v_kv.value, '') = '' then
          continue;
        end if;
        if coalesce(v_merged ->> v_kv.key, '') = '' then
          v_merged := v_merged || jsonb_build_object(v_kv.key, v_kv.value);
        else
          v_merged := v_merged || jsonb_build_object(
            v_kv.key,
            (v_merged ->> v_kv.key) || E'\n\n— ' || v_draft.name || E' —\n' || v_kv.value);
        end if;
      end loop;
      update campaign_briefs set values = v_merged where id = v_target_brief.id;
      delete from campaign_briefs where id = v_brief.id;
    end if;
  end loop;

  -- 4. THE RECEIPT. Onto the target's trail; the stamp trigger keeps who confirmed it (see above).
  --    The clock is untouched (d.6): readers take the earliest confirmed receipt.
  update campaign_brief_receipts
     set campaign_id = p_target_campaign
   where campaign_id = p_draft_campaign;

  -- 5. THE FILES. Folder by folder: the draft's campaign root and its four system folders each
  --    have a counterpart on the target (same kind, same name). Assets and custom sub-folders move
  --    across; the draft's system folders go with the campaign row.
  for v_folder in
    select f.id, f.kind, f.name from asset_folders f
     where f.campaign_id = p_draft_campaign and f.kind in ('campaign', 'asset_type')
  loop
    select t.id into v_target_folder from asset_folders t
     where t.campaign_id = p_target_campaign and t.kind = v_folder.kind
       and (v_folder.kind = 'campaign' or t.name = v_folder.name)
     limit 1;
    if v_target_folder is null then
      -- The target's tree is provisioned on insert; a missing folder means it was deleted by hand.
      -- Re-provisioning is idempotent and puts it back.
      perform app.provision_campaign_folders(p_target_campaign);
      select t.id into v_target_folder from asset_folders t
       where t.campaign_id = p_target_campaign and t.kind = v_folder.kind
         and (v_folder.kind = 'campaign' or t.name = v_folder.name)
       limit 1;
    end if;
    if v_target_folder is null then
      raise exception 'the target job has no folder to receive "%"', v_folder.name using errcode = 'P0002';
    end if;

    update assets set folder_id = v_target_folder where folder_id = v_folder.id;

    -- Custom sub-folders (never the draft's own system folders, which have their own iteration).
    update asset_folders c
       set parent_id   = v_target_folder,
           campaign_id = p_target_campaign,
           name        = case
                           when exists (select 1 from asset_folders x
                                         where x.parent_id = v_target_folder and x.name = c.name)
                           then c.name || ' (' || v_draft.name || ')'
                           else c.name
                         end
     where c.parent_id = v_folder.id
       and not (c.campaign_id = p_draft_campaign and c.kind = 'asset_type');
  end loop;
  -- Deeper descendants that carried the draft's id.
  update asset_folders set campaign_id = p_target_campaign
   where campaign_id = p_draft_campaign and kind not in ('campaign', 'asset_type');

  -- Library references to the draft, and to its stream. A reference the target already holds is
  -- dropped rather than duplicated (uq_asset_references).
  delete from asset_references ar
   where ar.ref_type = 'campaign' and ar.ref_id = p_draft_campaign
     and exists (select 1 from asset_references x
                  where x.asset_id = ar.asset_id and x.ref_type = 'campaign' and x.ref_id = p_target_campaign);
  update asset_references set ref_id = p_target_campaign
   where ref_type = 'campaign' and ref_id = p_draft_campaign;
  delete from asset_references ar
   where ar.ref_type = 'stream'
     and ar.ref_id in (select s.id from streams s where s.campaign_id = p_draft_campaign)
     and exists (select 1 from asset_references x
                  where x.asset_id = ar.asset_id and x.ref_type = 'stream' and x.ref_id = v_target_stream);
  update asset_references set ref_id = v_target_stream
   where ref_type = 'stream'
     and ref_id in (select s.id from streams s where s.campaign_id = p_draft_campaign);

  -- 6. Anything else that names the draft campaign by plain FK (no cascade). A draft has none in
  --    practice; re-pointing costs nothing and a stray row would otherwise refuse the delete.
  update bookings set campaign_id = p_target_campaign where campaign_id = p_draft_campaign;
  update jobs     set campaign_id = p_target_campaign where campaign_id = p_draft_campaign;

  -- 7. THE DRAFT GOES. Its streams are empty now; its folders, receipts and briefs have moved, and
  --    what remains under it cascades.
  delete from streams   where campaign_id = p_draft_campaign;
  delete from campaigns where id = p_draft_campaign and tenant_id = v_tenant;

  -- 8. WHO IS TOLD — I52 Action 15 (Edward, 17 Sep): the NEW deliverable's owner — it is theirs to
  -- brief and task, exactly as an approval is. Never the account manager who attached it.
  -- I53.18 (Edward, 21 Sep): the one-line notice the OTHER owners on the job used to get is GONE —
  -- "existing owners should only be notified of changes to their existing deliverables".
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v_tenant, d.owner_user_id, 'deliverable_added', d.name, 'deliverable', d.id, auth.uid(),
         jsonb_build_object('for_owner', true, 'due_at', d.due_at)
    from deliverables d
   where d.id = any (coalesce(v_moved, array[]::uuid[]))
     and d.owner_user_id is not null
     and d.owner_user_id is distinct from auth.uid();

  perform set_config('app.system_op', 'off', true);
  return p_target_campaign;
end $function$;

-- ---- approve_department_brief ----------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_department_brief(p_brief uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v campaign_briefs;
begin
  select * into v from campaign_briefs
   where id = p_brief and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign brief % not found', p_brief using errcode = 'P0002';
  end if;

  -- Idempotent. Approving twice is not an error, and it must not move the timestamp: the FIRST
  -- acceptance is the fact, and a second click would otherwise quietly rewrite when the department
  -- agreed — which is the number any question about this would be asked of.
  if v.approved_at is not null then
    return;
  end if;

  -- The department's own leads by scope; Power Admin and Traffic Manager by being tenant-scoped,
  -- which `in_write_scope` already resolves. No branch for the failsafe, deliberately (d.3).
  --
  -- I40: the campaign's ACCOUNT MANAGER is passed, where before this argument was null. ADR-0070
  -- d.2 was amended on 3 Sep — Edward: *"the account manager can approve their own brief, even if
  -- they created it"* — and the permission catalog says so in as many words, but an account-scoped
  -- person is matched by exactly this argument, so passing null made the grant unreachable. It is
  -- also what `may_generate_department_brief` already passes, so until now a manager could be told
  -- to generate a brief they would then be refused permission to accept. Same call, same argument.
  if not (app.has_permission('briefs', 'approve')
          and app.in_write_scope(v.department_id, null,
                                 app.campaign_account_manager(v.campaign_id))) then
    raise exception 'You cannot approve this department''s brief: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_brief_approvers(v.campaign_id, v.department_id))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_brief_approvers(v.campaign_id, v.department_id), ''),
            hint = 'approve_brief';
  end if;

  update campaign_briefs
     set approved_at = now(),
         approved_by = auth.uid()
   where id = p_brief;
end $function$;

-- ---- reopen_department_brief -----------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_department_brief(p_brief uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v campaign_briefs;
begin
  select * into v from campaign_briefs
   where id = p_brief and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign brief % not found', p_brief using errcode = 'P0002';
  end if;

  if not (app.has_permission('briefs', 'approve')
          and app.in_write_scope(v.department_id, null,
                                 app.campaign_account_manager(v.campaign_id))) then
    raise exception 'You cannot re-open this department''s brief: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_brief_approvers(v.campaign_id, v.department_id))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_brief_approvers(v.campaign_id, v.department_id), ''),
            hint = 'reopen_brief';
  end if;

  if v.approved_at is null then
    return;
  end if;

  update campaign_briefs
     set approved_at = null,
         approved_by = null
   where id = p_brief;

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v.tenant_id, auth.uid(), 'department_brief_reopened', 'campaign_briefs', p_brief,
          jsonb_build_object('campaign_id', v.campaign_id, 'department_id', v.department_id,
                             'was_approved_at', v.approved_at, 'was_approved_by', v.approved_by));
end $function$;

commit;
